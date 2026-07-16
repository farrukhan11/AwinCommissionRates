import mongoose from "mongoose";
import AwinMerchant from "../src/models/AwinMerchant.js";

const MONGODB_URI = process.env.MONGODB_URI;

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected.");

  const total = await AwinMerchant.countDocuments({});
  const completed = await AwinMerchant.countDocuments({ syncStatus: "completed" });
  const failed = await AwinMerchant.countDocuments({ syncStatus: "failed" });
  const pending = await AwinMerchant.countDocuments({ syncStatus: "pending" });
  const processing = await AwinMerchant.countDocuments({ syncStatus: "processing" });

  const fetched = await AwinMerchant.countDocuments({ commissionFetchStatus: "fetched" });
  const unavailable = await AwinMerchant.countDocuments({ commissionFetchStatus: "unavailable" });
  const fetchFailed = await AwinMerchant.countDocuments({ commissionFetchStatus: "failed" });

  console.log("\n--- Database Stats ---");
  console.log(`Total Merchants: ${total}`);
  console.log(`Sync Status:`);
  console.log(`  Completed:  ${completed}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Pending:    ${pending}`);
  console.log(`  Processing: ${processing}`);
  console.log(`Commission Fetch Status:`);
  console.log(`  Fetched:     ${fetched}`);
  console.log(`  Unavailable: ${unavailable}`);
  console.log(`  Failed:      ${fetchFailed}`);

  await mongoose.disconnect();
}

main().catch(err => console.error(err));
