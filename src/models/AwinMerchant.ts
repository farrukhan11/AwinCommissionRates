import mongoose, { Model, Schema } from "mongoose";

export type SyncStatus = "pending" | "processing" | "completed" | "failed";
export type DirectoryImportStatus = "discovered" | "active" | "missing";

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
  basicProgrammeInfo?: unknown;
  programmeStatus?: string;
  primaryRegion?: string;
  countryCode?: string;
  currencyCode?: string;
  sector?: string;
  displayUrl?: string;
  logoUrl?: string;
  isHidden?: boolean;
  programmeListFetchedAt?: Date;
  lastSeenInProgrammeListAt?: Date;
  directoryImportStatus: DirectoryImportStatus;
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
    basicProgrammeInfo: {
      type: Schema.Types.Mixed,
    },
    programmeStatus: {
      type: String,
    },
    primaryRegion: {
      type: String,
    },
    countryCode: {
      type: String,
    },
    currencyCode: {
      type: String,
    },
    sector: {
      type: String,
    },
    displayUrl: {
      type: String,
    },
    logoUrl: {
      type: String,
    },
    isHidden: {
      type: Boolean,
    },
    programmeListFetchedAt: {
      type: Date,
    },
    lastSeenInProgrammeListAt: {
      type: Date,
    },
    directoryImportStatus: {
      type: String,
      enum: ["discovered", "active", "missing"],
      default: "discovered",
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
