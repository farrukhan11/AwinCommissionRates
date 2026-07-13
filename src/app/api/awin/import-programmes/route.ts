import { NextRequest, NextResponse } from "next/server";
import { MongoBulkWriteError } from "mongodb";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { getAwinProgrammes } from "@/lib/awin/client";
import { AwinApiError } from "@/lib/awin/errors";
import {
  buildMerchantBulkOperation,
  deduplicateProgrammes,
  normalizeAwinProgramme,
  type NormalizedAwinProgramme,
} from "@/lib/awin/normalizers";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant from "@/models/AwinMerchant";
import AwinSyncRun from "@/models/AwinSyncRun";

export const runtime = "nodejs";

const BATCH_SIZE = 500;
const STALE_IMPORT_THRESHOLD_MS = 30 * 60 * 1000;

function unauthorizedResponse() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing API key",
      },
    },
    { status: 401 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof AwinApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred";
}

function getErrorCode(error: unknown): string {
  if (error instanceof AwinApiError) {
    return error.code;
  }

  if (error instanceof Error && error.message.includes("MongoDB")) {
    return "DATABASE_ERROR";
  }

  return "IMPORT_FAILED";
}

async function resolveRunningImportConflict() {
  const activeRun = await AwinSyncRun.findOne({
    type: "programme-directory-import",
    status: "running",
  }).sort({ startedAt: -1 });

  if (!activeRun) {
    return null;
  }

  const referenceTime = activeRun.startedAt ?? activeRun.createdAt;
  const isStale = Date.now() - referenceTime.getTime() > STALE_IMPORT_THRESHOLD_MS;

  if (!isStale) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AWIN_IMPORT_ALREADY_RUNNING",
          message: "An Awin programme import is already running",
        },
      },
      { status: 409 },
    );
  }

  await AwinSyncRun.findByIdAndUpdate(activeRun._id, {
    $set: {
      status: "failed",
      completedAt: new Date(),
      errorCode: "AWIN_IMPORT_STALE",
      errorMessage: "Import run exceeded the allowed running time",
    },
  });

  return null;
}

async function bulkUpsertProgrammes(
  programmes: NormalizedAwinProgramme[],
  importStartedAt: Date,
) {
  let insertedCount = 0;
  let matchedCount = 0;
  let modifiedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < programmes.length; index += BATCH_SIZE) {
    const batch = programmes.slice(index, index + BATCH_SIZE);
    const operations = batch.map((programme) =>
      buildMerchantBulkOperation(programme, importStartedAt),
    );

    try {
      const result = await AwinMerchant.bulkWrite(operations, {
        ordered: false,
      });

      insertedCount += result.upsertedCount;
      matchedCount += result.matchedCount;
      modifiedCount += result.modifiedCount;
    } catch (error) {
      if (error instanceof MongoBulkWriteError) {
        insertedCount += error.result.upsertedCount;
        matchedCount += error.result.matchedCount;
        modifiedCount += error.result.modifiedCount;
        failedCount += Array.isArray(error.writeErrors)
          ? error.writeErrors.length
          : 1;
        continue;
      }

      throw error;
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

export async function POST(request: NextRequest) {
  if (!isValidAdminApiKey(request.headers.get("x-admin-api-key"))) {
    return unauthorizedResponse();
  }

  let includeHidden = true;

  try {
    const bodyText = await request.text();

    if (bodyText.trim() !== "") {
      const body = JSON.parse(bodyText) as unknown;

      if (isRecord(body) && body.includeHidden !== undefined) {
        includeHidden = body.includeHidden !== false;
      }
    }
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid JSON body",
        },
      },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to connect to database",
        },
      },
      { status: 500 },
    );
  }

  const runningImportResponse = await resolveRunningImportConflict();

  if (runningImportResponse) {
    return runningImportResponse;
  }

  const importStartedAt = new Date();
  const syncRun = await AwinSyncRun.create({
    type: "programme-directory-import",
    status: "running",
    startedAt: importStartedAt,
  });

  try {
    const programmesResponse = await getAwinProgrammes({ includeHidden });

    if (!Array.isArray(programmesResponse)) {
      throw new AwinApiError(
        502,
        "AWIN_INVALID_RESPONSE",
        "Awin API programmes response is not an array",
      );
    }

    const totalReceived = programmesResponse.length;
    const validProgrammes: NormalizedAwinProgramme[] = [];
    let invalidProgrammes = 0;

    for (const rawProgramme of programmesResponse) {
      const normalized = normalizeAwinProgramme(rawProgramme);

      if (normalized.valid) {
        validProgrammes.push(normalized.programme);
      } else {
        invalidProgrammes += 1;
      }
    }

    const uniqueProgrammes = deduplicateProgrammes(validProgrammes);
    const bulkResult = await bulkUpsertProgrammes(
      uniqueProgrammes,
      importStartedAt,
    );

    // Merchants not seen in this import are marked missing only after a
    // successful Awin fetch and bulk upsert. Historical detail-sync data is
    // preserved and records are never deleted.
    const missingResult = await AwinMerchant.updateMany(
      {
        advertiserId: { $gt: 0 },
        $or: [
          { lastSeenInProgrammeListAt: { $lt: importStartedAt } },
          { lastSeenInProgrammeListAt: { $exists: false } },
        ],
      },
      {
        $set: {
          directoryImportStatus: "missing",
        },
      },
    );

    const finalStatus =
      invalidProgrammes > 0 || bulkResult.failedCount > 0
        ? "completed_with_errors"
        : "completed";

    await AwinSyncRun.findByIdAndUpdate(syncRun._id, {
      $set: {
        status: finalStatus,
        totalReceived,
        validProgrammes: validProgrammes.length,
        invalidProgrammes,
        insertedCount: bulkResult.insertedCount,
        updatedCount: bulkResult.updatedCount,
        matchedCount: bulkResult.matchedCount,
        modifiedCount: bulkResult.modifiedCount,
        failedCount: bulkResult.failedCount,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      runId: String(syncRun._id),
      summary: {
        totalReceived,
        validProgrammes: validProgrammes.length,
        invalidProgrammes,
        uniqueProgrammes: uniqueProgrammes.length,
        insertedCount: bulkResult.insertedCount,
        matchedCount: bulkResult.matchedCount,
        modifiedCount: bulkResult.modifiedCount,
        missingMarkedCount: missingResult.modifiedCount,
      },
    });
  } catch (error) {
    const errorCode = getErrorCode(error);
    const errorMessage = sanitizeErrorMessage(error);

    await AwinSyncRun.findByIdAndUpdate(syncRun._id, {
      $set: {
        status: "failed",
        completedAt: new Date(),
        errorCode,
        errorMessage,
      },
    });

    if (error instanceof AwinApiError && error.code === "AWIN_RATE_LIMITED") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "AWIN_RATE_LIMITED",
            message: "Awin API rate limit reached",
            retryAfterSeconds: error.retryAfterSeconds ?? 60,
          },
        },
        { status: 429 },
      );
    }

    if (error instanceof AwinApiError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.retryAfterSeconds !== undefined && {
              retryAfterSeconds: error.retryAfterSeconds,
            }),
          },
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      },
      { status: 500 },
    );
  }
}
