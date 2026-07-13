import { NextRequest, NextResponse } from "next/server";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { getAwinProgramDetails } from "@/lib/awin/client";
import { AwinApiError } from "@/lib/awin/errors";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant from "@/models/AwinMerchant";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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

export async function POST(request: NextRequest) {
  if (!isValidAdminApiKey(request.headers.get("x-admin-api-key"))) {
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

  let body: unknown;

  try {
    body = await request.json();
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

  const advertiserId = isRecord(body) ? body.advertiserId : undefined;

  if (!isPositiveInteger(advertiserId)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "advertiserId must be a positive integer",
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

  const merchant = await AwinMerchant.findOneAndUpdate(
    { advertiserId },
    {
      $setOnInsert: { advertiserId },
      $set: { syncStatus: "processing" },
      $inc: { syncAttempts: 1 },
    },
    { upsert: true, new: true },
  );

  if (!merchant) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DATABASE_ERROR",
          message: "Failed to save merchant record",
        },
      },
      { status: 500 },
    );
  }

  try {
    const data = await getAwinProgramDetails(advertiserId);

    const commissionRange = isRecord(data) ? data.commissionRange : undefined;
    const kpi = isRecord(data) ? data.kpi : undefined;
    const programmeInfo = isRecord(data) ? data.programmeInfo : undefined;
    const programmeName =
      isRecord(programmeInfo) && typeof programmeInfo.name === "string"
        ? programmeInfo.name
        : undefined;
    const membershipStatus =
      isRecord(programmeInfo) &&
      typeof programmeInfo.membershipStatus === "string"
        ? programmeInfo.membershipStatus
        : undefined;

    const updateFields: Record<string, unknown> = {
      syncStatus: "completed",
      programmeDetails: data,
      detailsFetchedAt: new Date(),
    };

    if (commissionRange !== undefined) {
      updateFields.commissionRange = commissionRange;
    }

    if (kpi !== undefined) {
      updateFields.kpi = kpi;
    }

    if (programmeInfo !== undefined) {
      updateFields.programmeInfo = programmeInfo;
    }

    if (programmeName !== undefined) {
      updateFields.programmeName = programmeName;
    }

    if (membershipStatus !== undefined) {
      updateFields.membershipStatus = membershipStatus;
    }

    await AwinMerchant.findOneAndUpdate(
      { advertiserId },
      {
        $set: updateFields,
        $unset: { lastSyncError: "" },
      },
    );

    return NextResponse.json({
      success: true,
      advertiserId,
      saved: true,
      data,
    });
  } catch (error) {
    const lastSyncError = sanitizeErrorMessage(error);

    await AwinMerchant.findOneAndUpdate(
      { advertiserId },
      {
        $set: {
          syncStatus: "failed",
          lastSyncError,
        },
      },
    );

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
          code: "INTERNAL_ERROR",
          message: "Failed to sync advertiser",
        },
      },
      { status: 500 },
    );
  }
}
