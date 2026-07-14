import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { getAwinProgramDetails } from "@/lib/awin/client";
import { AwinApiError } from "@/lib/awin/errors";
import { normalizeAwinProgramDetails } from "@/lib/awin/program-details";
import { connectToDatabase } from "@/lib/mongodb";
import AwinDetailSyncRun from "@/models/AwinDetailSyncRun";
import AwinMerchant from "@/models/AwinMerchant";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 5;
const PROCESSOR_LEASE_MS = 2 * 60 * 1000;
const STUCK_PROCESSING_MS = 5 * 60 * 1000;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function configuredBatchSize() {
  const parsed = Number.parseInt(process.env.AWIN_HTTP_TICK_BATCH_SIZE ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, parsed);
}

function retryDelaySeconds(attempts) {
  return Math.min(15 * 60, 15 * 2 ** Math.max(0, attempts - 1));
}

async function acquireRun(processorId) {
  const now = new Date();
  const run = await AwinDetailSyncRun.findOneAndUpdate(
    {
      activeLock: "global",
      status: { $in: ["pending", "running"] },
      $or: [
        { workerId: { $exists: false } },
        { workerId: null },
        { workerId: processorId },
        { leaseExpiresAt: { $exists: false } },
        { leaseExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "running",
        workerId: processorId,
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + PROCESSOR_LEASE_MS),
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

async function heartbeat(runId, processorId, advertiserId) {
  const now = new Date();
  await AwinDetailSyncRun.updateOne(
    { _id: runId, workerId: processorId },
    {
      $set: {
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + PROCESSOR_LEASE_MS),
        ...(advertiserId ? { lastAdvertiserId: advertiserId } : {}),
      },
    },
  );
}

async function releaseRun(runId, processorId) {
  await AwinDetailSyncRun.updateOne(
    { _id: runId, workerId: processorId },
    { $unset: { workerId: "", leaseExpiresAt: "" } },
  );
}

async function requeueStuckMerchants(runId) {
  const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_MS);
  await AwinMerchant.updateMany(
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

async function failExhaustedMerchants(runId, maxAttempts) {
  await AwinMerchant.updateMany(
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

async function finalizeRun(runId) {
  const [successCount, failedCount, pendingCount, processingCount] =
    await Promise.all([
      AwinMerchant.countDocuments({
        detailSyncRunId: runId,
        syncStatus: "completed",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: runId,
        syncStatus: "failed",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: runId,
        syncStatus: "pending",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: runId,
        syncStatus: "processing",
      }),
    ]);

  if (pendingCount > 0 || processingCount > 0) return false;

  await AwinDetailSyncRun.updateOne(
    { _id: runId },
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

  return true;
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

async function claimMerchant(runId, maxAttempts) {
  const now = new Date();
  return AwinMerchant.findOneAndUpdate(
    {
      detailSyncRunId: runId,
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
}

async function processMerchant(run, merchant) {
  const advertiserId = merchant.advertiserId;
  const maxAttempts = run.maxAttempts ?? 5;
  const attempts = merchant.detailRunAttempts ?? 1;

  try {
    const rawDetails = await getAwinProgramDetails(advertiserId);
    const normalized = normalizeAwinProgramDetails(rawDetails);
    const completedAt = new Date();
    const fields = Object.fromEntries(
      Object.entries({
        ...normalized,
        syncStatus: "completed",
        detailsFetchedAt: completedAt,
        detailSyncCompletedAt: completedAt,
      }).filter(([, value]) => value !== undefined),
    );

    await AwinMerchant.updateOne(
      { _id: merchant._id, detailSyncRunId: run._id },
      {
        $set: fields,
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

    return { outcome: "completed", advertiserId };
  } catch (error) {
    const awinError =
      error instanceof AwinApiError
        ? error
        : new AwinApiError(500, "TICK_ERROR", "Unexpected sync error");
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
      return { outcome: "fatal", advertiserId, error: awinError.message };
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
          $inc: { detailRunAttempts: -1 },
          $unset: { detailSyncLockedAt: "" },
        },
      );
      await AwinDetailSyncRun.updateOne(
        { _id: run._id },
        { $inc: { rateLimitCount: 1, retryCount: 1 } },
      );
      return {
        outcome: "rate_limited",
        advertiserId,
        retryAfterSeconds: retrySeconds,
      };
    }

    if (attempts < maxAttempts && awinError.code !== "AWIN_NOT_FOUND") {
      const retrySeconds = retryDelaySeconds(attempts);
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
      return { outcome: "retry", advertiserId, retryAfterSeconds: retrySeconds };
    }

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
    return { outcome: "failed", advertiserId, error: awinError.message };
  }
}

export async function POST(request) {
  if (!isValidAdminApiKey(request.headers.get("x-admin-api-key"))) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" },
      },
      { status: 401 },
    );
  }

  const processorId = `http-tick:${randomUUID()}`;
  let run;

  try {
    await connectToDatabase();
    run = await acquireRun(processorId);

    if (!run) {
      const activeRun = await AwinDetailSyncRun.findOne({ activeLock: "global" })
        .sort({ createdAt: -1 })
        .lean();
      return NextResponse.json({
        success: true,
        processedThisTick: 0,
        message: activeRun
          ? activeRun.status === "paused"
            ? "Detail sync is paused"
            : "Another processor is handling this run"
          : "No active detail sync run",
        status: activeRun?.status ?? "idle",
      });
    }

    await requeueStuckMerchants(run._id);
    await failExhaustedMerchants(run._id, run.maxAttempts ?? 5);

    const batchSize = configuredBatchSize();
    const results = [];

    for (let index = 0; index < batchSize; index += 1) {
      const freshRun = await AwinDetailSyncRun.findById(run._id).lean();
      if (!freshRun || freshRun.status === "paused") break;
      if (!["pending", "running"].includes(freshRun.status)) break;

      const merchant = await claimMerchant(run._id, freshRun.maxAttempts ?? 5);
      if (!merchant) break;

      await heartbeat(run._id, processorId, merchant.advertiserId);
      const result = await processMerchant(freshRun, merchant);
      results.push(result);

      if (result.outcome === "fatal" || result.outcome === "rate_limited") break;

      const requestDelay = Math.max(3100, freshRun.requestDelayMs ?? 3200);
      await sleep(requestDelay);
      await heartbeat(run._id, processorId, merchant.advertiserId);
    }

    const completed = await finalizeRun(run._id);
    const latestRun = await AwinDetailSyncRun.findById(run._id).lean();

    return NextResponse.json({
      success: true,
      runId: String(run._id),
      status: latestRun?.status ?? (completed ? "completed" : "running"),
      processedThisTick: results.length,
      results,
    });
  } catch (error) {
    console.error("POST /api/awin/detail-sync/tick failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DETAIL_SYNC_TICK_FAILED",
          message: "Failed to process Awin detail sync batch",
        },
      },
      { status: 500 },
    );
  } finally {
    if (run) await releaseRun(run._id, processorId);
  }
}
