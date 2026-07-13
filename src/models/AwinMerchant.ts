import mongoose, { Model, Schema } from "mongoose";

export type SyncStatus = "pending" | "processing" | "completed" | "failed";

export interface IAwinMerchant {
  advertiserId: number;
  programmeName?: string;
  membershipStatus?: string;
  programmeDetails?: unknown;
  commissionRange?: unknown;
  kpi?: unknown;
  programmeInfo?: unknown;
  detailsFetchedAt?: Date;
  syncStatus: SyncStatus;
  syncAttempts: number;
  lastSyncError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AwinMerchantSchema = new Schema<IAwinMerchant>(
  {
    advertiserId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    programmeName: {
      type: String,
    },
    membershipStatus: {
      type: String,
    },
    programmeDetails: {
      type: Schema.Types.Mixed,
    },
    commissionRange: {
      type: Schema.Types.Mixed,
    },
    kpi: {
      type: Schema.Types.Mixed,
    },
    programmeInfo: {
      type: Schema.Types.Mixed,
    },
    detailsFetchedAt: {
      type: Date,
    },
    syncStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    syncAttempts: {
      type: Number,
      default: 0,
    },
    lastSyncError: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

const AwinMerchant: Model<IAwinMerchant> =
  (mongoose.models.AwinMerchant as Model<IAwinMerchant> | undefined) ??
  mongoose.model<IAwinMerchant>("AwinMerchant", AwinMerchantSchema);

export default AwinMerchant;
