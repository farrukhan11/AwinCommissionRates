import mongoose, { Schema } from "mongoose";

const AwinDetailSyncRunSchema = new Schema(
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

AwinDetailSyncRunSchema.index(
  { activeLock: 1 },
  { unique: true, sparse: true },
);
AwinDetailSyncRunSchema.index({ status: 1, createdAt: 1 });
AwinDetailSyncRunSchema.index({ leaseExpiresAt: 1 });

const AwinDetailSyncRun =
  mongoose.models.AwinDetailSyncRun ??
  mongoose.model("AwinDetailSyncRun", AwinDetailSyncRunSchema);

export default AwinDetailSyncRun;
