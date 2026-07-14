import { randomUUID } from "node:crypto";
import os from "node:os";
import process from "node:process";
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
const AWIN_API_TOKEN = process.env.AWIN_API_TOKEN;
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID ?? "1951827";
const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const LEASE_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STUCK_PROCESSING_MS = 5 * 60 * 1000;
const IDLE_POLL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

if (!MONGODB_URI) throw new Error("MONGODB_URI is not configured");
if (!AWIN_API_TOKEN) throw new Error("AWIN_API_TOKEN is not configured");

let shuttingDown = false;

class AwinRequestError extends Error {
  constructor(status, code, message, retryAfterSeconds) {
    super(message);
    this.name = "AwinRequestError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const merchantSchema = new mongoose.Schema(
  {
    advertiserId: { type: Number, required: true, unique: true },
    programmeName: String,
    membershipStatus: String,
    programmeDetails: mongoose.Schema.Types.Mixed,
    commissionRange: mongoose.Schema.Types.Mixed,
    kpi: mongoose.Schema.Types.Mixed,
    programmeInfo: mongoose.Schema.Types.Mixed,
    detailsFetchedAt: Date,
    syncStatus: String,
    syncAttempts: { type: Number, default: 0 },
    lastSyncError: String,
    primaryRegion: String,
    countryCode: String,
    currencyCode: String,
    sector: String,
    displayUrl: String,
    logoUrl: String,
    detailSyncRunId: mongoose.Schema.Types.ObjectId,
    detailRunAttempts: { type: Number, default: 0 },
    detailSyncQueuedAt: Date,
    detailSyncLockedAt: Date,
    lastSyncAttemptAt: Date,
    nextRetryAt: Date,
    detailSyncCompletedAt: Date,
    commissionMin: Number,
    commissionMax: Number,
    commissionType: String,
  },
  { timestamps: true, strict: false },
);

merchantSchema.index({ detailSyncRunId: 1, syncStatus: 1, nextRetryAt: 1 });

const runSchema = new mongoose.Schema(
  {
    mode: String,
    status: String,
    activeLock: String,
    totalQueued: Number,
    processedCount: Number,
    successCount: Number,
    failedCount: Number,
    retryCount: Number,
    rateLimitCount: Number,
    requestDelayMs: Number,
    maxAttempts: Number,
    startedAt: Date,
    completedAt: Date,
    lastHeartbeatAt: Date,
    leaseExpiresAt: Date,
    workerId: String,
    lastAdvertiserId: Number,
    errorCode: String,
    errorMessage: String,
  },
  { timestamps: true, strict: false },
);

runSchema.index({ activeLock: 1 }, { unique: true, sparse: true });
runSchema.index({ status: 1, createdAt: 1 });

const AwinMerchant =
  mongoose.models.AwinMerchant ?? mongoose.model("AwinMerchant", merchantSchema);
const AwinDetailSyncRun =
  mongoose.models.AwinDetailSyncRun ??
  mongoose.model("AwinDetailSyncRun", runSchema);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const retryDate = Date.parse(value);
  if (Number.isNaN(retryDate)) return undefined;
  return Math.max(1, Math.ceil((retryDate - Date.now()) / 1000));
}

async function getProgramDetails(advertiserId) {
  const url = new URL(
    `https://api.awin.com/publishers/${AWIN_PUBLISHER_ID}/programmedetails`,
  );
  url.searchParams.set("advertiserId", String(advertiserId));
  url.searchParams.set("relationship", "any");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AWIN_API_TOKEN}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new AwinRequestError(
        502,
        "AWIN_INVALID_RESPONSE",
        "Awin returned invalid JSON",
      );
    }

    if (!response.ok) {
      const retryAfterSeconds = parseRetryAfter(
        response.headers.get("Retry-After"),
      );
      if (response.status === 401) {
        throw new AwinRequestError(
          401,
          "AWIN_UNAUTHORIZED",
          "Awin authentication failed",
        );
      }
      if (response.status === 403) {
        throw new AwinRequestError(
          403,
          "AWIN_FORBIDDEN",
          "Awin access forbidden",
        );
      }
      if (response.status === 404) {
        throw new AwinRequestError(
          404,
          "AWIN_NOT_FOUND",
          "Awin programme not found",
        );
      }
      if (response.status === 429) {
        throw new AwinRequestError(
          429,
          "AWIN_RATE_LIMITED",
          "Awin rate limit reached",
          retryAfterSeconds,
        );
      }
      if (response.status >= 500) {
        throw new AwinRequestError(
          response.status,
          "AWIN_SERVER_ERROR",
          "Awin server error",
        );
      }
      throw new AwinRequestError(
        response.status,
        "AWIN_REQUEST_FAILED",
        "Awin request failed",
      );
    }

    return data;
  } catch (error) {
    if (error instanceof AwinRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AwinRequestError(
        504,
        "AWIN_TIMEOUT",
        "Awin request timed out",
      );
    }
    throw new AwinRequestError(
      502,
      "AWIN_REQUEST_FAILED",
      "Awin request failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeDetails(raw) {
  const fields = { programmeDetails: raw };
  if (!isRecord(raw)) return fields;

  if (raw.commissionRange !== undefined) {
    fields.commissionRange = raw.commissionRange;
  }
  if (raw.kpi !== undefined) fields.kpi = raw.kpi;
  if (raw.programmeInfo !== undefined) fields.programmeInfo = raw.programmeInfo;

  if (isRecord(raw.programmeInfo)) {
    const info = raw.programmeInfo;
    const mappings = {
      programmeName: stringValue(info.name),
      membershipStatus: stringValue(info.membershipStatus),
      displayUrl: stringValue(info.displayUrl),
      logoUrl: stringValue(info.logoUrl),
      currencyCode: stringValue(info.currencyCode),
      sector: stringValue(info.primarySector),
    };

    for (const [key, value] of Object.entries(mappings)) {
      if (value !== undefined) fields[key] = value;
    }

    if (isRecord(info.primaryRegion)) {
      const region = stringValue(info.primaryRegion.name);
      const country = stringValue(info.primaryRegion.countryCode);
      if (region) fields.primaryRegion = region;
      if (country) fields.countryCode = country;
    }
  }

  if (Array.isArray(raw.commissionRange)) {
    const ranges = raw.commissionRange.filter(isRecord);
    const minimums = ranges
      .map((range) => finiteNumber(range.min))
      .filter((value) => value !== undefined);
    const maximums = ranges
      .map((range) => finiteNumber(range.max))
      .filter((value) => value !== undefined);
    const types = ranges
      .map((range) => stringValue(range.type))
      .filter(Boolean);

    if (minimums.length) fields.commissionMin = Math.min(...minimums);
    if (maximums.length) fields.commissionMax = Math.max(...maximums);
    if (types.length) fields.commissionType = [...new Set(types)].join(",");
  }

  return fields;
}

async function acquireRun() {
  const now = new Date();
  const run = await AwinDetailSyncRun.findOneAndUpdate(
    {
      activeLock: "global",
      status: { $in: ["pending", "running"] },
      $or: [
        { workerId: WORKER_ID },
        { leaseExpiresAt: { $exists: false } },
        { leaseExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "running",
        workerId: WORKER_ID,
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    },
    { new: true, sort: { createdAt: 1 } },
  );

  if (run && !run.startedAt) {
    run.startedAt = now;
    await run.save();
  }

  return run;
}

async function heartbeat(runId, advertiserId) {
  const now = new Date();
  const result = await AwinDetailSyncRun.updateOne(
    { _id: runId, workerId: WORKER_ID },
    {
      $set: {
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        ...(advertiserId ? { lastAdvertiserId: advertiserId } : {}),
      },
    },
  );
  return result.modifiedCount === 1 || result.matchedCount === 1;
}

async function sleepWithHeartbeat(runId, milliseconds) {
  let remaining = milliseconds;
  while (!shuttingDown && remaining > 0) {
    const chunk = Math.min(remaining, HEARTBEAT_INTERVAL_MS);
    await sleep(chunk);
    remaining -= chunk;
    if (!(await heartbeat(runId))) return false;
  }
  return !shuttingDown;
}

async function releaseLease(runId) {
  await AwinDetailSyncRun.updateOne(
    { _id: runId, workerId: WORKER_ID },
    { $unset: { workerId: "", leaseExpiresAt: "" } },
  );
}

async function failRun(runId, code, message) {
  await AwinDetailSyncRun.updateOne(
    { _id: runId },
    {
      $set: {
        status: "failed",
        completedAt: new Date(),
        errorCode: code,
        errorMessage: message,
      },
      $unset: { activeLock: "", workerId: "", leaseExpiresAt: "" },
    },
  );
}

async function requeueStuckMerchants(runId) {
  const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_MS);
  return AwinMerchant.updateMany(
    {
      detailSyncRunId: runId,
      syncStatus: "processing",
      detailSyncLockedAt: { $lt: stuckBefore },
    },
    {
      $set: { syncStatus: "pending" },
      $unset: { detailSyncLockedAt: "" },
    },
  );
}

async function failExhaustedPending(runId, maxAttempts) {
  return AwinMerchant.updateMany(
    {
      detailSyncRunId: runId,
      syncStatus: "pending",
      detailRunAttempts: { $gte: maxAttempts },
    },
    {
      $set: {
        syncStatus: "failed",
        lastSyncError: "Maximum detail sync attempts reached",
      },
      $unset: { detailSyncLockedAt: "", nextRetryAt: "" },
    },
  );
}

async function finalizeRun(run) {
  const [successCount, failedCount, pendingCount, processingCount] =
    await Promise.all([
      AwinMerchant.countDocuments({
        detailSyncRunId: run._id,
        syncStatus: "completed",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: run._id,
        syncStatus: "failed",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: run._id,
        syncStatus: "pending",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: run._id,
        syncStatus: "processing",
      }),
    ]);

  if (pendingCount > 0 || processingCount > 0) return false;

  await AwinDetailSyncRun.updateOne(
    { _id: run._id },
    {
      $set: {
        status: failedCount > 0 ? "completed_with_errors" : "completed",
        processedCount: successCount + failedCount,
        successCount,
        failedCount,
        completedAt: new Date(),
      },
      $unset: { activeLock: "", workerId: "", leaseExpiresAt: "" },
    },
  );

  console.log(
    `[worker] run ${run._id} completed: ${successCount} success, ${failedCount} failed`,
  );
  return true;
}

async function processRun(run) {
  while (!shuttingDown) {
    const freshRun = await AwinDetailSyncRun.findById(run._id).lean();
    if (!freshRun) return;

    if (freshRun.status === "paused") {
      await releaseLease(run._id);
      return;
    }
    if (!["pending", "running"].includes(freshRun.status)) {
      await releaseLease(run._id);
      return;
    }
    if (!(await heartbeat(run._id))) return;

    const maxAttempts = freshRun.maxAttempts ?? 5;
    await failExhaustedPending(run._id, maxAttempts);

    const now = new Date();
    const merchant = await AwinMerchant.findOneAndUpdate(
      {
        detailSyncRunId: run._id,
        syncStatus: "pending",
        detailRunAttempts: { $lt: maxAttempts },
        $or: [
          { nextRetryAt: { $exists: false } },
          { nextRetryAt: { $lte: now } },
        ],
      },
      {
        $set: {
          syncStatus: "processing",
          detailSyncLockedAt: now,
          lastSyncAttemptAt: now,
        },
        $inc: { detailRunAttempts: 1, syncAttempts: 1 },
      },
      { new: true, sort: { advertiserId: 1 } },
    );

    if (!merchant) {
      const recovered = await requeueStuckMerchants(run._id);
      if (recovered.modifiedCount > 0) {
        console.warn(
          `[worker] recovered ${recovered.modifiedCount} stuck merchant(s)`,
        );
        continue;
      }

      const nextPending = await AwinMerchant.findOne({
        detailSyncRunId: run._id,
        syncStatus: "pending",
      })
        .sort({ nextRetryAt: 1 })
        .select("nextRetryAt")
        .lean();

      if (nextPending) {
        const waitMs = nextPending.nextRetryAt
          ? Math.max(
              1_000,
              Math.min(60_000, nextPending.nextRetryAt.getTime() - Date.now()),
            )
          : 3_000;
        if (!(await sleepWithHeartbeat(run._id, waitMs))) return;
        continue;
      }

      const processingExists = await AwinMerchant.exists({
        detailSyncRunId: run._id,
        syncStatus: "processing",
      });
      if (processingExists) {
        if (!(await sleepWithHeartbeat(run._id, 3_000))) return;
        continue;
      }

      if (await finalizeRun(freshRun)) return;
      if (!(await sleepWithHeartbeat(run._id, 3_000))) return;
      continue;
    }

    const advertiserId = merchant.advertiserId;
    let calledAwin = false;

    try {
      calledAwin = true;
      const rawDetails = await getProgramDetails(advertiserId);
      const detailFields = normalizeDetails(rawDetails);
      const completedAt = new Date();

      await AwinMerchant.updateOne(
        { _id: merchant._id, detailSyncRunId: run._id },
        {
          $set: {
            ...detailFields,
            syncStatus: "completed",
            detailsFetchedAt: completedAt,
            detailSyncCompletedAt: completedAt,
          },
          $unset: {
            lastSyncError: "",
            nextRetryAt: "",
            detailSyncLockedAt: "",
          },
        },
      );

      await AwinDetailSyncRun.updateOne(
        { _id: run._id },
        {
          $inc: { processedCount: 1, successCount: 1 },
          $set: { lastAdvertiserId: advertiserId },
        },
      );
      console.log(`[worker] ${advertiserId} completed`);
    } catch (error) {
      const awinError =
        error instanceof AwinRequestError
          ? error
          : new AwinRequestError(
              500,
              "WORKER_ERROR",
              "Unexpected worker error",
            );
      const attempts = merchant.detailRunAttempts ?? 1;
      const fatal = ["AWIN_UNAUTHORIZED", "AWIN_FORBIDDEN"].includes(
        awinError.code,
      );

      if (fatal) {
        await AwinMerchant.updateOne(
          { _id: merchant._id },
          {
            $set: { syncStatus: "failed", lastSyncError: awinError.message },
            $unset: { detailSyncLockedAt: "" },
          },
        );
        await failRun(run._id, awinError.code, awinError.message);
        return;
      }

      if (awinError.code === "AWIN_RATE_LIMITED") {
        const retrySeconds = Math.max(60, awinError.retryAfterSeconds ?? 60);
        await AwinMerchant.updateOne(
          { _id: merchant._id },
          {
            $set: {
              syncStatus: "pending",
              nextRetryAt: new Date(Date.now() + retrySeconds * 1_000),
              lastSyncError: awinError.message,
            },
            $inc: { detailRunAttempts: -1 },
            $unset: { detailSyncLockedAt: "" },
          },
        );
        await AwinDetailSyncRun.updateOne(
          { _id: run._id },
          { $inc: { rateLimitCount: 1, retryCount: 1 } },
        );
        console.warn(`[worker] rate limited; waiting ${retrySeconds}s`);
        if (!(await sleepWithHeartbeat(run._id, retrySeconds * 1_000))) return;
        continue;
      }

      if (attempts < maxAttempts && awinError.code !== "AWIN_NOT_FOUND") {
        const retrySeconds = Math.min(
          15 * 60,
          15 * 2 ** Math.max(0, attempts - 1),
        );
        await AwinMerchant.updateOne(
          { _id: merchant._id },
          {
            $set: {
              syncStatus: "pending",
              nextRetryAt: new Date(Date.now() + retrySeconds * 1_000),
              lastSyncError: awinError.message,
            },
            $unset: { detailSyncLockedAt: "" },
          },
        );
        await AwinDetailSyncRun.updateOne(
          { _id: run._id },
          { $inc: { retryCount: 1 } },
        );
        console.warn(`[worker] ${advertiserId} retry in ${retrySeconds}s`);
      } else {
        await AwinMerchant.updateOne(
          { _id: merchant._id },
          {
            $set: { syncStatus: "failed", lastSyncError: awinError.message },
            $unset: { detailSyncLockedAt: "", nextRetryAt: "" },
          },
        );
        await AwinDetailSyncRun.updateOne(
          { _id: run._id },
          {
            $inc: { processedCount: 1, failedCount: 1 },
            $set: { lastAdvertiserId: advertiserId },
          },
        );
        console.error(`[worker] ${advertiserId} failed: ${awinError.code}`);
      }
    } finally {
      if (!shuttingDown) await heartbeat(run._id, advertiserId);
      if (calledAwin && !shuttingDown) {
        const requestDelay = Math.max(3_100, freshRun.requestDelayMs ?? 3_200);
        if (!(await sleepWithHeartbeat(run._id, requestDelay))) return;
      }
    }
  }

  await releaseLease(run._id);
}

async function main() {
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  await Promise.all([AwinMerchant.init(), AwinDetailSyncRun.init()]);
  console.log(`[worker] connected as ${WORKER_ID}`);

  while (!shuttingDown) {
    const run = await acquireRun();
    if (!run) {
      await sleep(IDLE_POLL_MS);
      continue;
    }

    console.log(`[worker] processing run ${run._id} (${run.mode})`);
    await processRun(run);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    console.log(`[worker] received ${signal}, shutting down safely`);
  });
}

main()
  .catch((error) => {
    console.error(
      "[worker] fatal error",
      error instanceof Error ? error.message : "unknown",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
