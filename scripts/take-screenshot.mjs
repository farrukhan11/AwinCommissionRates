import puppeteer from "puppeteer-core";
import path from "node:path";

async function main() {
  console.log("Connecting to Chrome...");
  const browser = await puppeteer.connect({
    browserURL: "http://localhost:9222",
    defaultViewport: null,
  });

  const pages = await browser.pages();
  console.log(`Found ${pages.length} pages.`);
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const url = page.url();
    console.log(`- Page ${i}: ${url}`);
    
    try {
      const sanitizedUrl = url.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
      const screenshotPath = path.resolve(`C:/Users/farrukh.saleeem/.gemini/antigravity-ide/brain/dbc091f2-dbdd-46ff-8873-c6d65f837f26/page_${i}_${sanitizedUrl}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`Saved: ${screenshotPath}`);
    } catch (err) {
      console.error(`Failed to take screenshot of page ${i}:`, err.message);
    }
  }
  
  await browser.disconnect();
}

main().catch(err => {
  console.error("Error taking screenshot:", err);
});
