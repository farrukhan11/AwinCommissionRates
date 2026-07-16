import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import mongoose from "mongoose";
import puppeteer from "puppeteer-core";
import AwinMerchant from "../src/models/AwinMerchant.js";

// Make sure we have the MongoDB URI
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("Error: MONGODB_URI is not set. Run with: node --env-file=.env scripts/awin-browser-scrape.mjs");
  process.exit(1);
}

const PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID || "1951827";

function parseCommissionRate(display) {
  let commissionMin = null;
  let commissionMax = null;
  let commissionType = "percentage";
  
  const cleaned = display.trim();
  const pctRegex = /(\d+(?:\.\d+)?)%/g;
  const pctMatches = [...cleaned.matchAll(pctRegex)].map(m => parseFloat(m[1]));
  
  if (pctMatches.length > 0) {
    commissionMin = Math.min(...pctMatches);
    commissionMax = Math.max(...pctMatches);
    commissionType = "percentage";
  } else {
    const valRegex = /(?:[A-Z]{3}\s*)?(\d+(?:\.\d+)?)/g;
    const valMatches = [...cleaned.matchAll(valRegex)].map(m => parseFloat(m[1]));
    if (valMatches.length > 0) {
      commissionMin = Math.min(...valMatches);
      commissionMax = Math.max(...valMatches);
      commissionType = "fixed";
    }
  }
  
  return { commissionMin, commissionMax, commissionType };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // 1. Connect to MongoDB
  console.log("[scraper] Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("[scraper] MongoDB connected successfully.");

  // 2. Load Advertiser IDs
  let advertiserIds = [];
  const txtPath = path.resolve("merchant_ids.txt");
  if (fs.existsSync(txtPath)) {
    const content = fs.readFileSync(txtPath, "utf8");
    advertiserIds = content.split(/[,\s\n\r]+/).map(Number).filter(Boolean);
    console.log(`[scraper] Loaded ${advertiserIds.length} IDs from ${txtPath}`);
  } else {
    console.log(`[scraper] No merchant_ids.txt found at ${txtPath}. Fetching un-joined and un-fetched merchants from DB...`);
    const merchants = await AwinMerchant.find({
      membershipStatus: { $ne: "joined" },
      commissionFetchStatus: { $ne: "fetched" }
    }).select("advertiserId");
    advertiserIds = merchants.map(m => m.advertiserId);
    console.log(`[scraper] Found ${advertiserIds.length} matching merchants in database.`);
  }

  if (advertiserIds.length === 0) {
    console.log("[scraper] No advertiser IDs to process.");
    process.exit(0);
  }

  // 3. Connect to Chrome running with remote debugging
  console.log("[scraper] Connecting to Chrome via CDP (http://localhost:9222)...");
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: "http://localhost:9222",
      defaultViewport: null,
    });
    console.log("[scraper] Connected to Chrome successfully.");
  } catch (error) {
    console.error("[scraper] Failed to connect to Chrome. Make sure Chrome is running with remote debugging enabled:");
    console.error("  start chrome.exe --remote-debugging-port=9222");
    console.error("Error details:", error.message);
    process.exit(1);
  }

  const page = await browser.newPage();
  console.log("[scraper] Opened new tab.");

  // 4. Process loop
  for (let i = 0; i < advertiserIds.length; i++) {
    const advertiserId = advertiserIds[i];
    const url = `https://ui.awin.com/commission-manager/us/awin/publisher/${PUBLISHER_ID}/timeline?advertiserIds=${advertiserId}`;
    
    console.log(`\n[scraper] [${i + 1}/${advertiserIds.length}] Processing advertiser ${advertiserId}...`);
    
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      
      // Wait for the timeline container/table to render
      await sleep(2500);

      // Scrape the DOM with support for both layouts
      const result = await page.evaluate((advId) => {
        const bodyText = document.body.innerText;
        
        // --- LAYOUT 1: Simple Table (Not-Joined layout) ---
        let headerText = "";
        const divs = Array.from(document.querySelectorAll("h1, h2, h3, h4, div"));
        for (const d of divs) {
          const text = d.textContent?.trim() || "";
          if (text.startsWith("Commission Rates for") && text.length < 150) {
            headerText = text;
            break;
          }
        }
        
        if (headerText) {
          const advertiserName = headerText.replace("Commission Rates for", "").trim();
          const table = document.querySelector("table");
          if (table) {
            const rows = Array.from(table.querySelectorAll("tr"));
            const rates = [];
            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll("td, th")).map(c => c.textContent?.trim() || "");
              if (cells.length >= 2 && cells[0].toLowerCase() !== "commission group") {
                const groupName = cells[0];
                const groupRate = cells[1];
                if (groupRate && (groupRate.includes("%") || /\d/.test(groupRate))) {
                  rates.push({ groupName, groupRate });
                }
              }
            }
            
            if (rates.length > 0) {
              const uniqueRates = [...new Set(rates.map(r => r.groupRate))];
              let rateText = "";
              if (uniqueRates.length === 1) {
                rateText = uniqueRates[0];
              } else {
                rateText = rates.map(r => `${r.groupName}: ${r.groupRate}`).join(" / ");
              }
              
              return {
                success: true,
                layout: "table",
                advertiserName,
                rateText
              };
            }
          }
          
          // Fallback inside Table layout if no table elements found
          const pageRates = [];
          const leafElements = Array.from(document.querySelectorAll("*")).filter(el => el.children.length === 0);
          for (const leaf of leafElements) {
            const text = leaf.textContent?.trim() || "";
            if (/\d+(?:\.\d+)?%/.test(text) && text.length < 50) {
              pageRates.push(text);
            }
          }
          
          if (pageRates.length > 0) {
            return {
              success: true,
              layout: "table-fallback",
              advertiserName,
              rateText: [...new Set(pageRates)].join(" / ")
            };
          }
        }
        
        // --- LAYOUT 2: Timeline Chart (Joined layout) ---
        const elements = Array.from(document.querySelectorAll("*"));
        let rowElement = null;
        for (const el of elements) {
          if (el.children.length === 0) {
            const text = el.textContent || "";
            if (text.includes(`(${advId})`)) {
              rowElement = el;
              break;
            }
          }
        }
        
        if (rowElement) {
          const advertiserName = rowElement.textContent.trim();
          let parent = rowElement.parentElement;
          let depth = 0;
          let rateText = null;
          
          while (parent && depth < 8) {
            const siblingLeaves = Array.from(parent.querySelectorAll("*")).filter(el => el.children.length === 0);
            for (const leaf of siblingLeaves) {
              const text = leaf.textContent?.trim() || "";
              if (text.includes("%") && text !== rowElement.textContent?.trim()) {
                if (/\d+(?:\.\d+)?%/.test(text)) {
                  rateText = text;
                  break;
                }
              }
            }
            if (rateText) break;
            parent = parent.parentElement;
            depth++;
          }
          
          if (rateText) {
            return {
              success: true,
              layout: "timeline",
              advertiserName,
              rateText
            };
          }
          
          // Fallback inside Timeline layout
          const pageRates = [];
          const leafElements = Array.from(document.querySelectorAll("*")).filter(el => el.children.length === 0);
          for (const leaf of leafElements) {
            const text = leaf.textContent?.trim() || "";
            if (/\d+(?:\.\d+)?%/.test(text) && text.length < 100) {
              pageRates.push(text);
            }
          }
          
          if (pageRates.length > 0) {
            return { 
              success: true, 
              layout: "timeline-fallback",
              advertiserName, 
              rateText: pageRates[0]
            };
          }
        }
        
        return { error: "commission_rate_not_found", bodyText: bodyText.slice(0, 1000) };
      }, advertiserId);

      if (result.success) {
        const { advertiserName, rateText, layout } = result;
        const parsed = parseCommissionRate(rateText);
        const nameCleaned = advertiserName.replace(/\s*\(\d+\)$/, "").trim();
        
        console.log(`  Advertiser: ${nameCleaned} (Layout: ${layout})`);
        console.log(`  Commission Display: "${rateText}"`);
        console.log(`  Parsed Min: ${parsed.commissionMin}%, Max: ${parsed.commissionMax}%, Type: ${parsed.commissionType}`);
        
        // Update database
        const completedAt = new Date();
        const updateResult = await AwinMerchant.updateOne(
          { advertiserId },
          {
            $set: {
              programmeName: nameCleaned,
              commissionDisplay: rateText,
              commissionFetchStatus: "fetched",
              syncStatus: "completed",
              detailsFetchedAt: completedAt,
              detailSyncCompletedAt: completedAt,
              ...parsed
            },
            $unset: {
              lastSyncError: "",
              nextRetryAt: "",
              detailSyncLockedAt: ""
            }
          }
        );
        
        if (updateResult.matchedCount > 0) {
          console.log("  Successfully updated in database.");
        } else {
          // If not in database, we can create it
          await AwinMerchant.create({
            advertiserId,
            programmeName: nameCleaned,
            commissionDisplay: rateText,
            commissionFetchStatus: "fetched",
            syncStatus: "completed",
            detailsFetchedAt: completedAt,
            detailSyncCompletedAt: completedAt,
            ...parsed
          });
          console.log("  Advertiser not found in DB. Created new record.");
        }
      } else {
        console.warn(`  Failed to scrape: ${result.error}`);
        // Mark failed in database so we know
        await AwinMerchant.updateOne(
          { advertiserId },
          {
            $set: {
              commissionFetchStatus: "failed",
              lastSyncError: `Scraper error: ${result.error}`
            }
          }
        );
      }
    } catch (err) {
      console.error(`  Error during execution: ${err.message}`);
    }

    // Delay to control execution speed (e.g. ~3300ms delay to keep rate to ~18/min)
    await sleep(3300);
  }

  console.log("\n[scraper] Finished processing all advertiser IDs.");
  await page.close();
  await browser.disconnect();
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error("[scraper] Fatal error:", err);
  process.exit(1);
});
