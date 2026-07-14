import { NextResponse } from "next/server";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import {
  DetailSyncConflictError,
  parseStartDetailSyncInput,
  startDetailSyncRun,
} from "@/lib/awin/detail-sync";
import { connectToDatabase } from "@/lib/mongodb";

export const runtime = "nodejs";

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

  let body = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "INVALID_REQUEST", message: "Invalid JSON body" },
      },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();
    const input = parseStartDetailSyncInput(body);
    const run = await startDetailSyncRun(input);

    return NextResponse.json({
      success: true,
      runId: String(run._id),
      status: run.status,
      mode: run.mode,
      totalQueued: run.totalQueued,
      requestDelayMs: run.requestDelayMs,
      estimatedSeconds:
        run.totalQueued > 0
          ? Math.ceil((run.totalQueued * run.requestDelayMs) / 1000)
          : 0,
    });
  } catch (error) {
    if (error instanceof DetailSyncConflictError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "AWIN_DETAIL_SYNC_ALREADY_ACTIVE",
            message: error.message,
          },
        },
        { status: 409 },
      );
    }

    if (error instanceof Error && error.message.includes("advertiserIds")) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "INVALID_REQUEST", message: error.message },
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DETAIL_SYNC_START_FAILED",
          message: "Failed to start Awin detail sync",
        },
      },
      { status: 500 },
    );
  }
}
