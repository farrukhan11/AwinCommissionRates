import { NextRequest, NextResponse } from "next/server";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { getAwinProgramDetails } from "@/lib/awin/client";
import { AwinApiError } from "@/lib/awin/errors";
import { normalizeAwinProgramDetails } from "@/lib/awin/program-details";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant from "@/models/AwinMerchant";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  if (!isValidAdminApiKey(request.headers.get("x-admin-api-key"))) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_REQUEST", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  const advertiserId = isRecord(body) ? body.advertiserId : undefined;
  if (typeof advertiserId !== "number" || !Number.isInteger(advertiserId) || advertiserId <= 0) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_REQUEST", message: "advertiserId must be a positive integer" } },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "DATABASE_ERROR", message: "Failed to connect to database" } },
      { status: 500 },
    );
  }

  await AwinMerchant.findOneAndUpdate(
    { advertiserId },
    {
      $setOnInsert: { advertiserId, detailRunAttempts: 0 },
      $set: { syncStatus: "processing", lastSyncAttemptAt: new Date() },
      $inc: { syncAttempts: 1 },
    },
    { upsert: true },
  );

  try {
    const data = await getAwinProgramDetails(advertiserId);
    const normalized = normalizeAwinProgramDetails(data);
    const now = new Date();
    const updateFields = Object.fromEntries(
      Object.entries({
        ...normalized,
        syncStatus: "completed",
        detailsFetchedAt: now,
        detailSyncCompletedAt: now,
      }).filter(([, value]) => value !== undefined),
    );

    await AwinMerchant.updateOne(
      { advertiserId },
      {
        $set: updateFields,
        $unset: { lastSyncError: "", nextRetryAt: "", detailSyncLockedAt: "" },
      },
    );

    return NextResponse.json({ success: true, advertiserId, saved: true, data });
  } catch (error) {
    const message = error instanceof AwinApiError ? error.message : "Failed to sync advertiser";
    await AwinMerchant.updateOne(
      { advertiserId },
      { $set: { syncStatus: "failed", lastSyncError: message } },
    );

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
      { success: false, error: { code: "INTERNAL_ERROR", message: "Failed to sync advertiser" } },
      { status: 500 },
    );
  }
}
