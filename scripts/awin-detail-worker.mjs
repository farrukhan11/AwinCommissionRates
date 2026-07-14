import os from "node:os";
import process from "node:process";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
const AWIN_API_TOKEN = process.env.AWIN_API_TOKEN;
const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID ?? "1951827";
const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const LEASE_MS = 2 * 60 * 1000;
const STUCK_PROCESSING_MS = 10 * 60 * 1000;
const IDLE_POLL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

if (!MONGODB_URI) throw new Error("MONGODB_URI is not configured");
if (!AWIN_API_TOKEN) throw new Error("AWIN_API_TOKEN is not configured");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
    syncAttempts: Number,
    lastSyncError: String,
    primaryRegion: String,
    countryCode: String,
    currencyCode: String,
    sector: String,
    displayUrl: String,
    logoUrl: String,
    detailSyncRunId: mongoose.Schema.Types.ObjectId,
    detailRunAttempts: Number,
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

const AwinMerchant =
  mongoose.models.AwinMerchant ?? mongoose.model("AwinMerchant", merchantSchema);
const AwinDetailSyncRun =
  mongoose.models.AwinDetailSyncRun ??
  mongoose.model("AwinDetailSyncRun", runSchema);

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(1, Math.ceil((date - Date.now()) / 1000));
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

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new AwinRequestError(502, "AWIN_INVALID_RESPONSE", "Awin returned invalid JSON");
    }

    if (!response.ok) {
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      if (response.status === 401) throw new AwinRequestError(401, "AWIN_UNAUTHORIZED", "Awin authentication failed");
      if (response.status === 403) throw new AwinRequestError(403, "AWIN_FORBIDDEN", "Awin access forbidden");
      if (response.status === 404) throw new AwinRequestError(404, "AWIN_NOT_FOUND", "Awin programme not found");
      if (response.status === 429) throw new AwinRequestError(429, "AWIN_RATE_LIMITED", "Awin rate limit reached", retryAfter);
      if (response.status >= 500) throw new AwinRequestError(response.status, "AWIN_SERVER_ERROR", "Awin server error");
      throw new AwinRequestError(response.status, "AWIN_REQUEST_FAILED", "Awin request failed");
    }

    return data;
  } catch (error) {
    if (error instanceof AwinRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AwinRequestError(504, "AWIN_TIMEOUT", "Awin request timed out");
    }
    throw new AwinRequestError(502, "AWIN_REQUEST_FAILED", "Awin request failed");
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeDetails(raw) {
  const fields = { programmeDetails: raw };
  if (!isRecord(raw)) return fields;

  if (raw.commissionRange !== undefined) fields.commissionRange = raw.commissionRange;
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
    const mins = ranges.map((item) => finiteNumber(item.min)).filter((item) => item !== undefined);
    const maxes = ranges.map((item) => finiteNumber(item.max)).filter((item) => item !== undefined);
    const types = ranges.map((item) => stringValue(item.type)).filter(Boolean);
    if (mins.length) fields.commissionMin = Math.min(...mins);
    if (maxes.length) fields.commissionMax = Math.max(...maxes);
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
  await AwinDetailSyncRun.updateOne(
    { _id: runId, workerId: WORKER_ID },
    {
      $set: {
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        ...(advertiserId ? { lastAdvertiserId: advertiserId } : {}),
      },
    },
  );
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

async function finalizeRun(run) {
  const [successCount, failedCount, pendingCount, processingCount] = await Promise.all([
    AwinMerchant.countDocuments({ detailSyncRunId: run._id, syncStatus: "completed" }),
    AwinMerchant.countDocuments({ detailSyncRunId: run._id, syncStatus: "failed" }),
    AwinMerchant.countDocuments({ detailSyncRunId: run._id, syncStatus: "pending" }),
    AwinMerchant.countDocuments({ detailSyncRunId: run._id, syncStatus: "processing" }),
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

  console.log(`[worker] run ${run._id} completed: ${successCount} success, ${failedCount} failed`);
  return true;
}

async function processRun(run) {
  const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_MS);
  await AwinMerchant.updateMany(
    {
      detailSyncRunId: run._id,
      syncStatus: "processing",
      detailSyncLockedAt: { $lt: stuckBefore },
    },
    {
      $set: { syncStatus: "pending" },
      $unset: { detailSyncLockedAt: "" },
    },
  );

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

    await heartbeat(run._id);
    const now = new Date();
    const merchant = await AwinMerchant.findOneAndUpdate(
      {
        detailSyncRunId: run._id,
        syncStatus: "pending",
        detailRunAttempts: { $lt: freshRun.maxAttempts ?? 5 },
        $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }],
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
      const pending = await AwinMerchant.findOne({
        detailSyncRunId: run._id,
        syncStatus: "pending",
      })
        .sort({ nextRetryAt: 1 })
        .select("nextRetryAt")
        .lean();

      if (pending) {
        const waitMs = pending.nextRetryAt
          ? Math.max(1000, Math.min(60_000, pending.nextRetryAt.getTime() - Date.now()))
          : 5000;
        await sleep(waitMs);
        continue;
      }

      if (await finalizeRun(freshRun)) return;
      await sleep(3000);
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
          : new AwinRequestError(500, "WORKER_ERROR", "Unexpected worker error");
      const attempts = merchant.detailRunAttempts ?? 1;
      const maxAttempts = freshRun.maxAttempts ?? 5;
      const fatal = ["AWIN_UNAUTHORIZED", "AWIN_FORBIDDEN"].includes(awinError.code);

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
              nextRetryAt: new Date(Date.now() + retrySeconds * 1000),
              lastSyncError: awinError.message,
            },
            $unset: { detailSyncLockedAt: "" },
          },
        );
        await AwinDetailSyncRun.updateOne(
          { _id: run._id },
          { $inc: { rateLimitCount: 1, retryCount: 1 } },
        );
        console.warn(`[worker] rate limited; sleeping ${retrySeconds}s`);
        await sleep(retrySeconds * 1000);
        continue;
      }

      if (attempts < maxAttempts && awinError.code !== "AWIN_NOT_FOUND") {
        const retrySeconds = Math.min(15 * 60, 15 * 2 ** Math.max(0, attempts - 1));
        await AwinMerchant.updateOne(
          { _id: merchant._id },
          {
            $set: {
              syncStatus: "pending",
              nextRetryAt: new Date(Date.now() + retrySeconds * 1000),
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
      await heartbeat(run._id, advertiserId);
      if (calledAwin && !shuttingDown) {
        await sleep(Math.max(3100, freshRun.requestDelayMs ?? 3200));
      }
    }
  }

  await releaseLease(run._id);
}

async function main() {
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
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
    console.error("[worker] fatal error", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
