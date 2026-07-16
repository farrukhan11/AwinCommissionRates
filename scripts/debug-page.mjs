import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";

async function main() {
  console.log("[debug] Connecting to Chrome...");
  const browser = await puppeteer.connect({
    browserURL: "http://localhost:9222",
    defaultViewport: null,
  });

  const page = await browser.newPage();
  const testId = "37866"; // FIFA Store DE
  const url = `https://ui.awin.com/commission-manager/us/awin/publisher/1951827/timeline?advertiserIds=${testId}`;
  
  console.log(`[debug] Navigating to: ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  
  console.log("[debug] Waiting 5 seconds for any rendering...");
  await new Promise(r => setTimeout(r, 5000));
  
  const pageTitle = await page.title();
  const currentUrl = page.url();
  const bodyText = await page.evaluate(() => document.body.innerText);
  
  console.log(`[debug] Page Title: ${pageTitle}`);
  console.log(`[debug] Current URL: ${currentUrl}`);
  console.log("[debug] Body text length:", bodyText.length);
  console.log("[debug] Body text preview:\n", bodyText.slice(0, 1500));
  
  // Bring to front and take screenshot
  await page.bringToFront();
  const screenshotPath = path.resolve("C:/Users/farrukh.saleeem/.gemini/antigravity-ide/brain/dbc091f2-dbdd-46ff-8873-c6d65f837f26/debug-37866.png");
  await page.screenshot({ path: screenshotPath });
  console.log(`[debug] Screenshot saved to: ${screenshotPath}`);
  
  // Save body text to a file for closer inspection
  fs.writeFileSync("debug-body-text.txt", bodyText, "utf8");
  console.log("[debug] Saved full body text to debug-body-text.txt");
  
  await page.close();
  await browser.disconnect();
}

main().catch(err => {
  console.error("[debug] Error:", err);
});
