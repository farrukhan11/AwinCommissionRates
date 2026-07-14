import type { FilterQuery } from "mongoose";

import AwinMerchant, { type IAwinMerchant } from "@/models/AwinMerchant";
import AwinDetailSyncRun, {
  type DetailSyncMode,
  type IAwinDetailSyncRun,
} from "@/models/AwinDetailSyncRun";

export interface StartDetailSyncInput {
  mode?: DetailSyncMode;
  staleAfterDays?: number;
  maxAttempts?: number;
  requestDelayMs?: number;
  advertiserIds?: number[];
}

export class DetailSyncConflictError extends Error {
  constructor() {
    super("An Awin detail sync is already active");
    this.name = "DetailSyncConflictError";
  }
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeAdvertiserIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const ids = value.filter(
    (item): item is number =>
      typeof item === "number" && Number.isInteger(item) && item > 0,
  );

  return [...new Set(ids)].slice(0, 1000);
}

export function parseStartDetailSyncInput(raw: unknown): Required<
  Pick<StartDetailSyncInput, "mode" | "staleAfterDays" | "maxAttempts" | "requestDelayMs">
> & { advertiserIds?: number[] } {
  const record =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const allowedModes: DetailSyncMode[] = [
    "missing",
    "stale",
    "failed",
    "all",
    "selected",
  ];
  const requestedMode = record.mode;
  const mode = allowedModes.includes(requestedMode as DetailSyncMode)
    ? (requestedMode as DetailSyncMode)
    : "missing";
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

function buildMerchantFilter(input: ReturnType<typeof parseStartDetailSyncInput>) {
  const filter: FilterQuery<IAwinMerchant> = {
    directoryImportStatus: "active",
  };

  if (input.mode === "selected") {
    filter.advertiserId = { $in: input.advertiserIds ?? [] };
  } else if (input.mode === "failed") {
    filter.syncStatus = "failed";
  } else if (input.mode === "missing") {
    filter.$or = [
      { detailsFetchedAt: { $exists: false } },
      { programmeDetails: { $exists: false } },
    ];
  } else if (input.mode === "stale") {
    const cutoff = new Date(
      Date.now() - input.staleAfterDays * 24 * 60 * 60 * 1000,
    );
    filter.$or = [
      { detailsFetchedAt: { $exists: false } },
      { detailsFetchedAt: { $lt: cutoff } },
    ];
  }

  return filter;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export async function startDetailSyncRun(
  input: ReturnType<typeof parseStartDetailSyncInput>,
): Promise<IAwinDetailSyncRun> {
  let run: IAwinDetailSyncRun & { _id: unknown };

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
      run.activeLock = undefined;
    }

    await (run as unknown as { save(): Promise<unknown> }).save();
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
