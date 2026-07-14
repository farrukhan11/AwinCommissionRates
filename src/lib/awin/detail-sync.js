import AwinMerchant from "@/models/AwinMerchant";
import AwinDetailSyncRun from "@/models/AwinDetailSyncRun";
import { AWIN_DETAIL_FETCH_VERSION } from "@/lib/awin/program-details";

export class DetailSyncConflictError extends Error {
  constructor() {
    super("An Awin detail sync is already active");
    this.name = "DetailSyncConflictError";
  }
}

function clampInteger(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeAdvertiserIds(value) {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter(
    (item) => typeof item === "number" && Number.isInteger(item) && item > 0,
  );
  return [...new Set(ids)].slice(0, 1000);
}

export function parseStartDetailSyncInput(raw) {
  const record =
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};

  const allowedModes = ["missing", "stale", "failed", "all", "selected"];
  const requestedMode = record.mode;
  const mode = allowedModes.includes(requestedMode) ? requestedMode : "missing";
  const advertiserIds = normalizeAdvertiserIds(record.advertiserIds);

  if (mode === "selected" && (!advertiserIds || advertiserIds.length === 0)) {
    throw new Error("advertiserIds are required for selected mode");
  }

  return {
    mode,
    staleAfterDays: clampInteger(record.staleAfterDays, 30, 1, 3650),
    maxAttempts: clampInteger(record.maxAttempts, 5, 1, 10),
    requestDelayMs: clampInteger(record.requestDelayMs, 3200, 3100, 60_000),
    ...(advertiserIds && { advertiserIds }),
  };
}

function buildMerchantFilter(input) {
  const filter = { directoryImportStatus: "active" };

  if (input.mode === "selected") {
    filter.advertiserId = { $in: input.advertiserIds ?? [] };
  } else if (input.mode === "failed") {
    filter.syncStatus = "failed";
  } else if (input.mode === "missing") {
    filter.$or = [
      { detailsFetchedAt: { $exists: false } },
      { programmeDetails: { $exists: false } },
      { detailFetchVersion: { $ne: AWIN_DETAIL_FETCH_VERSION } },
    ];
  } else if (input.mode === "stale") {
    const cutoff = new Date(
      Date.now() - input.staleAfterDays * 24 * 60 * 60 * 1000,
    );
    filter.$or = [
      { detailsFetchedAt: { $exists: false } },
      { detailsFetchedAt: { $lt: cutoff } },
      { detailFetchVersion: { $ne: AWIN_DETAIL_FETCH_VERSION } },
    ];
  }

  return filter;
}

function isDuplicateKeyError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export async function startDetailSyncRun(input) {
  let run;

  await AwinDetailSyncRun.init();

  try {
    run = await AwinDetailSyncRun.create({
      mode: input.mode,
      status: "pending",
      activeLock: "global",
      staleAfterDays: input.staleAfterDays,
      requestDelayMs: input.requestDelayMs,
      maxAttempts: input.maxAttempts,
      selectedAdvertiserIds: input.advertiserIds,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new DetailSyncConflictError();
    throw error;
  }

  try {
    const now = new Date();
    const result = await AwinMerchant.updateMany(buildMerchantFilter(input), {
      $set: {
        detailSyncRunId: run._id,
        detailRunAttempts: 0,
        detailSyncQueuedAt: now,
        syncStatus: "pending",
      },
      $unset: {
        detailSyncLockedAt: "",
        nextRetryAt: "",
        lastSyncError: "",
      },
    });

    run.totalQueued = result.matchedCount;
    if (result.matchedCount === 0) {
      run.status = "completed";
      run.completedAt = now;
      run.set("activeLock", undefined);
    }

    await run.save();
    return run;
  } catch (error) {
    await AwinDetailSyncRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "failed",
        completedAt: new Date(),
        errorCode: "QUEUE_PREPARATION_FAILED",
        errorMessage: "Failed to queue merchants for detail sync",
      },
      $unset: { activeLock: "" },
    });
    throw error;
  }
}
