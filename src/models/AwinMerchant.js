import mongoose, { Schema } from "mongoose";

const AwinMerchantSchema = new Schema(
  {
    advertiserId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    programmeName: String,
    membershipStatus: String,
    programmeDetails: Schema.Types.Mixed,
    commissionRange: Schema.Types.Mixed,
    kpi: Schema.Types.Mixed,
    programmeInfo: Schema.Types.Mixed,
    detailsFetchedAt: Date,
    detailFetchVersion: Number,
    detailFetchStrategy: String,
    syncStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    syncAttempts: {
      type: Number,
      default: 0,
    },
    lastSyncError: String,
    basicProgrammeInfo: Schema.Types.Mixed,
    programmeStatus: String,
    primaryRegion: String,
    countryCode: String,
    currencyCode: String,
    sector: String,
    displayUrl: String,
    logoUrl: String,
    isHidden: Boolean,
    programmeListFetchedAt: Date,
    lastSeenInProgrammeListAt: Date,
    directoryImportStatus: {
      type: String,
      enum: ["discovered", "active", "missing"],
      default: "discovered",
      index: true,
    },
    detailSyncRunId: {
      type: Schema.Types.ObjectId,
      ref: "AwinDetailSyncRun",
      index: true,
    },
    detailRunAttempts: {
      type: Number,
      default: 0,
    },
    detailSyncQueuedAt: Date,
    detailSyncLockedAt: Date,
    lastSyncAttemptAt: Date,
    nextRetryAt: Date,
    detailSyncCompletedAt: Date,
    commissionMin: Number,
    commissionMax: Number,
    commissionType: String,
    commissionDisplay: String,
    commissionFetchStatus: {
      type: String,
      enum: ["fetched", "unavailable", "failed"],
      index: true,
    },
    commissionUnavailableReason: String,
  },
  {
    timestamps: true,
  },
);

AwinMerchantSchema.index({ detailSyncRunId: 1, syncStatus: 1, nextRetryAt: 1 });
AwinMerchantSchema.index({ programmeName: 1 });
AwinMerchantSchema.index({ countryCode: 1, directoryImportStatus: 1 });

const AwinMerchant =
  mongoose.models.AwinMerchant ??
  mongoose.model("AwinMerchant", AwinMerchantSchema);

export default AwinMerchant;
