import mongoose from "mongoose";
import AwinMerchant from "../src/models/AwinMerchant.js";

const MONGODB_URI = process.env.MONGODB_URI;

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected.");

  // Find completed but not fetched
  const count = await AwinMerchant.countDocuments({
    syncStatus: "completed",
    commissionFetchStatus: { $ne: "fetched" }
  });

  console.log(`Found ${count} merchants marked as completed but without a fetched commission.`);

  if (count > 0) {
    const list = await AwinMerchant.find({
      syncStatus: "completed",
      commissionFetchStatus: { $ne: "fetched" }
    }).select("advertiserId programmeName");

    console.log("List of merchants to reset:");
    list.forEach(m => console.log(`- ${m.advertiserId}: ${m.programmeName}`));

    const result = await AwinMerchant.updateMany(
      {
        syncStatus: "completed",
        commissionFetchStatus: { $ne: "fetched" }
      },
      {
        $set: {
          syncStatus: "pending",
          commissionFetchStatus: null,
          detailsFetchedAt: null,
          detailSyncCompletedAt: null
        }
      }
    );

    console.log(`Successfully reset ${result.modifiedCount} merchants to 'pending'.`);
  } else {
    console.log("No merchants need resetting.");
  }

  await mongoose.disconnect();
}

main().catch(err => console.error(err));
