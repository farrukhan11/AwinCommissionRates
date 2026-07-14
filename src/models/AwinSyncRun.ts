import mongoose, { Model, Schema } from "mongoose";

export type AwinSyncRunType = "programme-directory-import";
export type AwinSyncRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";

export interface IAwinSyncRun {
  type: AwinSyncRunType;
  status: AwinSyncRunStatus;
  activeLock?: string;
  totalReceived: number;
  validProgrammes: number;
  invalidProgrammes: number;
  insertedCount: number;
  updatedCount: number;
  matchedCount: number;
  modifiedCount: number;
  failedCount: number;
  startedAt?: Date;
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AwinSyncRunSchema = new Schema<IAwinSyncRun>(
  {
    type: {
      type: String,
      enum: ["programme-directory-import"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "completed_with_errors", "failed"],
      required: true,
    },
    activeLock: String,
    totalReceived: { type: Number, default: 0 },
    validProgrammes: { type: Number, default: 0 },
    invalidProgrammes: { type: Number, default: 0 },
    insertedCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    matchedCount: { type: Number, default: 0 },
    modifiedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    startedAt: Date,
    completedAt: Date,
    errorCode: String,
    errorMessage: String,
  },
  { timestamps: true },
);

AwinSyncRunSchema.index({ activeLock: 1 }, { unique: true, sparse: true });
AwinSyncRunSchema.index({ type: 1, createdAt: -1 });

const AwinSyncRun: Model<IAwinSyncRun> =
  (mongoose.models.AwinSyncRun as Model<IAwinSyncRun> | undefined) ??
  mongoose.model<IAwinSyncRun>("AwinSyncRun", AwinSyncRunSchema);

export default AwinSyncRun;
