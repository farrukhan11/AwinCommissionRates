import { NextResponse } from "next/server";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { getAwinProgrammes } from "@/lib/awin/client";
import { AwinApiError } from "@/lib/awin/errors";
import {
  buildMerchantBulkOperation,
  deduplicateProgrammes,
  normalizeAwinProgramme,
} from "@/lib/awin/normalizers";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant from "@/models/AwinMerchant";
import AwinSyncRun from "@/models/AwinSyncRun";

export const runtime = "nodejs";

const BATCH_SIZE = 500;
const STALE_IMPORT_THRESHOLD_MS = 30 * 60 * 1000;

function responseError(status, code, message, extra) {
  return NextResponse.json(
    { success: false, error: { code, message, ...extra } },
    { status },
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDuplicateKeyError(error) {
  return isRecord(error) && error.code === 11000;
}

function readNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function getBulkWriteErrorSummary(error) {
  if (!isRecord(error)) return null;

  const result = isRecord(error.result) ? error.result : null;
  const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : null;
  const errorName = typeof error.name === "string" ? error.name : "";
  const isBulkWriteError =
    errorName === "MongoBulkWriteError" || writeErrors !== null;

  if (!isBulkWriteError || !result) return null;

  return {
    insertedCount: readNonNegativeInteger(result.upsertedCount),
    matchedCount: readNonNegativeInteger(result.matchedCount),
    modifiedCount: readNonNegativeInteger(result.modifiedCount),
    failedCount: writeErrors?.length ?? 1,
  };
}

async function bulkUpsertProgrammes(programmes, importStartedAt) {
  let insertedCount = 0;
  let matchedCount = 0;
  let modifiedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < programmes.length; index += BATCH_SIZE) {
    const operations = programmes
      .slice(index, index + BATCH_SIZE)
      .map((programme) =>
        buildMerchantBulkOperation(programme, importStartedAt),
      );

    try {
      const result = await AwinMerchant.bulkWrite(operations, { ordered: false });
      insertedCount += result.upsertedCount;
      matchedCount += result.matchedCount;
      modifiedCount += result.modifiedCount;
    } catch (error) {
      const summary = getBulkWriteErrorSummary(error);
      if (!summary) throw error;

      insertedCount += summary.insertedCount;
      matchedCount += summary.matchedCount;
      modifiedCount += summary.modifiedCount;
      failedCount += summary.failedCount;
    }
  }

  return {
    insertedCount,
    matchedCount,
    modifiedCount,
    updatedCount: modifiedCount,
    failedCount,
  };
}

export async function POST(request) {
  if (!isValidAdminApiKey(request.headers.get("x-admin-api-key"))) {
    return responseError(401, "UNAUTHORIZED", "Invalid or missing API key");
  }

  let includeHidden = true;
  try {
    const text = await request.text();
    if (text.trim()) {
      const body = JSON.parse(text);
      if (!isRecord(body)) {
        return responseError(
          400,
          "INVALID_REQUEST",
          "Request body must be an object",
        );
      }
      if (
        body.includeHidden !== undefined &&
        typeof body.includeHidden !== "boolean"
      ) {
        return responseError(
          400,
          "INVALID_REQUEST",
          "includeHidden must be a boolean",
        );
      }
      includeHidden = body.includeHidden ?? true;
    }
  } catch {
    return responseError(400, "INVALID_REQUEST", "Invalid JSON body");
  }

  try {
    await connectToDatabase();
    await AwinSyncRun.init();
  } catch {
    return responseError(
      500,
      "DATABASE_ERROR",
      "Failed to connect to database",
    );
  }

  const activeRun = await AwinSyncRun.findOne({
    activeLock: "programme-directory",
  });
  if (activeRun) {
    const referenceTime = activeRun.startedAt ?? activeRun.createdAt;
    if (Date.now() - referenceTime.getTime() <= STALE_IMPORT_THRESHOLD_MS) {
      return responseError(
        409,
        "AWIN_IMPORT_ALREADY_RUNNING",
        "An Awin programme import is already running",
      );
    }

    await AwinSyncRun.findByIdAndUpdate(activeRun._id, {
      $set: {
        status: "failed",
        completedAt: new Date(),
        errorCode: "AWIN_IMPORT_STALE",
        errorMessage: "Import run exceeded the allowed running time",
      },
      $unset: { activeLock: "" },
    });
  }

  const importStartedAt = new Date();
  let syncRun;
  try {
    syncRun = await AwinSyncRun.create({
      type: "programme-directory-import",
      status: "running",
      activeLock: "programme-directory",
      startedAt: importStartedAt,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return responseError(
        409,
        "AWIN_IMPORT_ALREADY_RUNNING",
        "An Awin programme import is already running",
      );
    }
    return responseError(
      500,
      "DATABASE_ERROR",
      "Failed to create import run",
    );
  }

  try {
    const response = await getAwinProgrammes({ includeHidden });
    if (!Array.isArray(response)) {
      throw new AwinApiError(
        502,
        "AWIN_INVALID_RESPONSE",
        "Awin API programmes response is not an array",
      );
    }

    const validProgrammes = [];
    let invalidProgrammes = 0;
    for (const rawProgramme of response) {
      const normalized = normalizeAwinProgramme(rawProgramme);
      if (normalized.valid) validProgrammes.push(normalized.programme);
      else invalidProgrammes += 1;
    }

    const uniqueProgrammes = deduplicateProgrammes(validProgrammes);
    const bulkResult = await bulkUpsertProgrammes(
      uniqueProgrammes,
      importStartedAt,
    );

    let missingMarkedCount = 0;
    if (bulkResult.failedCount === 0) {
      const missingResult = await AwinMerchant.updateMany(
        {
          advertiserId: { $gt: 0 },
          $or: [
            { lastSeenInProgrammeListAt: { $lt: importStartedAt } },
            { lastSeenInProgrammeListAt: { $exists: false } },
          ],
        },
        { $set: { directoryImportStatus: "missing" } },
      );
      missingMarkedCount = missingResult.modifiedCount;
    }

    const finalStatus =
      invalidProgrammes > 0 || bulkResult.failedCount > 0
        ? "completed_with_errors"
        : "completed";

    await AwinSyncRun.findByIdAndUpdate(syncRun._id, {
      $set: {
        status: finalStatus,
        totalReceived: response.length,
        validProgrammes: validProgrammes.length,
        invalidProgrammes,
        insertedCount: bulkResult.insertedCount,
        updatedCount: bulkResult.updatedCount,
        matchedCount: bulkResult.matchedCount,
        modifiedCount: bulkResult.modifiedCount,
        failedCount: bulkResult.failedCount,
        completedAt: new Date(),
      },
      $unset: { activeLock: "" },
    });

    return NextResponse.json({
      success: true,
      runId: String(syncRun._id),
      summary: {
        totalReceived: response.length,
        validProgrammes: validProgrammes.length,
        invalidProgrammes,
        uniqueProgrammes: uniqueProgrammes.length,
        insertedCount: bulkResult.insertedCount,
        matchedCount: bulkResult.matchedCount,
        modifiedCount: bulkResult.modifiedCount,
        failedCount: bulkResult.failedCount,
        missingMarkedCount,
      },
    });
  } catch (error) {
    const awinError = error instanceof AwinApiError ? error : null;
    await AwinSyncRun.findByIdAndUpdate(syncRun._id, {
      $set: {
        status: "failed",
        completedAt: new Date(),
        errorCode: awinError?.code ?? "IMPORT_FAILED",
        errorMessage:
          awinError?.message ?? "Programme directory import failed",
      },
      $unset: { activeLock: "" },
    });

    if (awinError) {
      return responseError(
        awinError.status,
        awinError.code,
        awinError.message,
        {
          ...(awinError.retryAfterSeconds !== undefined && {
            retryAfterSeconds: awinError.retryAfterSeconds,
          }),
        },
      );
    }

    return responseError(
      500,
      "IMPORT_FAILED",
      "Programme directory import failed",
    );
  }
}
