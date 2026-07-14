import mongoose, { Model, Schema, Types } from "mongoose";

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
  detailSyncRunId?: Types.ObjectId;
  detailRunAttempts: number;
  detailSyncQueuedAt?: Date;
  detailSyncLockedAt?: Date;
  lastSyncAttemptAt?: Date;
  nextRetryAt?: Date;
  detailSyncCompletedAt?: Date;
  commissionMin?: number;
  commissionMax?: number;
  commissionType?: string;
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
    programmeName: String,
    membershipStatus: String,
    programmeDetails: Schema.Types.Mixed,
    commissionRange: Schema.Types.Mixed,
    kpi: Schema.Types.Mixed,
    programmeInfo: Schema.Types.Mixed,
    detailsFetchedAt: Date,
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
  },
  {
    timestamps: true,
  },
);

AwinMerchantSchema.index({ detailSyncRunId: 1, syncStatus: 1, nextRetryAt: 1 });
AwinMerchantSchema.index({ programmeName: 1 });
AwinMerchantSchema.index({ countryCode: 1, directoryImportStatus: 1 });

const AwinMerchant: Model<IAwinMerchant> =
  (mongoose.models.AwinMerchant as Model<IAwinMerchant> | undefined) ??
  mongoose.model<IAwinMerchant>("AwinMerchant", AwinMerchantSchema);

export default AwinMerchant;
