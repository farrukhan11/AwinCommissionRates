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
      enum: [
        "pending",
        "running",
        "completed",
        "completed_with_errors",
        "failed",
      ],
      required: true,
    },
    totalReceived: {
      type: Number,
      default: 0,
    },
    validProgrammes: {
      type: Number,
      default: 0,
    },
    invalidProgrammes: {
      type: Number,
      default: 0,
    },
    insertedCount: {
      type: Number,
      default: 0,
    },
    updatedCount: {
      type: Number,
      default: 0,
    },
    matchedCount: {
      type: Number,
      default: 0,
    },
    modifiedCount: {
      type: Number,
      default: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    errorCode: {
      type: String,
    },
    errorMessage: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

const AwinSyncRun: Model<IAwinSyncRun> =
  (mongoose.models.AwinSyncRun as Model<IAwinSyncRun> | undefined) ??
  mongoose.model<IAwinSyncRun>("AwinSyncRun", AwinSyncRunSchema);

export default AwinSyncRun;
