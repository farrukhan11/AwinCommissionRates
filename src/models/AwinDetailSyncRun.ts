import mongoose, { Model, Schema } from "mongoose";

export type DetailSyncMode = "missing" | "stale" | "failed" | "all" | "selected";
export type DetailSyncRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "completed_with_errors"
  | "failed";

export interface IAwinDetailSyncRun {
  mode: DetailSyncMode;
  status: DetailSyncRunStatus;
  activeLock?: string;
  totalQueued: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  retryCount: number;
  rateLimitCount: number;
  requestDelayMs: number;
  maxAttempts: number;
  staleAfterDays?: number;
  selectedAdvertiserIds?: number[];
  startedAt?: Date;
  completedAt?: Date;
  lastHeartbeatAt?: Date;
  leaseExpiresAt?: Date;
  workerId?: string;
  lastAdvertiserId?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AwinDetailSyncRunSchema = new Schema<IAwinDetailSyncRun>(
  {
    mode: {
      type: String,
      enum: ["missing", "stale", "failed", "all", "selected"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "running",
        "paused",
        "cancelled",
        "completed",
        "completed_with_errors",
        "failed",
      ],
      default: "pending",
      index: true,
    },
    activeLock: String,
    totalQueued: { type: Number, default: 0 },
    processedCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    rateLimitCount: { type: Number, default: 0 },
    requestDelayMs: { type: Number, default: 3200 },
    maxAttempts: { type: Number, default: 5 },
    staleAfterDays: Number,
    selectedAdvertiserIds: [Number],
    startedAt: Date,
    completedAt: Date,
    lastHeartbeatAt: Date,
    leaseExpiresAt: Date,
    workerId: String,
    lastAdvertiserId: Number,
    errorCode: String,
    errorMessage: String,
  },
  { timestamps: true },
);

AwinDetailSyncRunSchema.index({ activeLock: 1 }, { unique: true, sparse: true });
AwinDetailSyncRunSchema.index({ status: 1, createdAt: 1 });
AwinDetailSyncRunSchema.index({ leaseExpiresAt: 1 });

const AwinDetailSyncRun: Model<IAwinDetailSyncRun> =
  (mongoose.models.AwinDetailSyncRun as Model<IAwinDetailSyncRun> | undefined) ??
  mongoose.model<IAwinDetailSyncRun>(
    "AwinDetailSyncRun",
    AwinDetailSyncRunSchema,
  );

export default AwinDetailSyncRun;
