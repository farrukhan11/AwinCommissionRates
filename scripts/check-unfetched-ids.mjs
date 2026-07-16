import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import AwinMerchant from "../src/models/AwinMerchant.js";

const MONGODB_URI = process.env.MONGODB_URI;

async function main() {
  await mongoose.connect(MONGODB_URI);

  const txtPath = path.resolve("merchant_ids.txt");
  const content = fs.readFileSync(txtPath, "utf8");
  const advertiserIds = content.split(/[,\s\n\r]+/).map(Number).filter(Boolean);

  console.log(`Checking ${advertiserIds.length} IDs from merchant_ids.txt...`);

  const unfetched = [];
  const fetched = [];
  const notInDb = [];

  for (const advertiserId of advertiserIds) {
    const merchant = await AwinMerchant.findOne({ advertiserId });
    if (!merchant) {
      notInDb.push(advertiserId);
    } else if (merchant.commissionFetchStatus !== "fetched") {
      unfetched.push({
        advertiserId,
        programmeName: merchant.programmeName,
        syncStatus: merchant.syncStatus,
        commissionFetchStatus: merchant.commissionFetchStatus,
        lastSyncError: merchant.lastSyncError
      });
    } else {
      fetched.push(advertiserId);
    }
  }

  console.log(`\nResults:`);
  console.log(`- Fetched successfully: ${fetched.length}`);
  console.log(`- Not in DB at all: ${notInDb.length}`);
  console.log(`- In DB but NOT fetched: ${unfetched.length}`);

  if (unfetched.length > 0) {
    console.log(`\nList of In DB but NOT fetched:`);
    unfetched.forEach(m => {
      console.log(`  ID: ${m.advertiserId} | Name: ${m.programmeName} | SyncStatus: ${m.syncStatus} | FetchStatus: ${m.commissionFetchStatus} | Error: ${m.lastSyncError}`);
    });
  }

  if (notInDb.length > 0) {
    console.log(`\nList of Not in DB at all: ${notInDb.join(", ")}`);
  }

  await mongoose.disconnect();
}

main().catch(err => console.error(err));
