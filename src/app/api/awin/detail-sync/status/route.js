import { NextResponse } from "next/server";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant from "@/models/AwinMerchant";
import AwinDetailSyncRun from "@/models/AwinDetailSyncRun";

export const runtime = "nodejs";

export async function GET(request) {
  if (!isValidAdminApiKey(request.headers.get("x-admin-api-key"))) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" },
      },
      { status: 401 },
    );
  }

  try {
    await connectToDatabase();

    const run = await AwinDetailSyncRun.findOne().sort({ createdAt: -1 }).lean();

    if (!run) {
      return NextResponse.json({ success: true, latestRun: null });
    }

    const [pending, processing, completed, failed] = await Promise.all([
      AwinMerchant.countDocuments({
        detailSyncRunId: run._id,
        syncStatus: "pending",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: run._id,
        syncStatus: "processing",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: run._id,
        syncStatus: "completed",
      }),
      AwinMerchant.countDocuments({
        detailSyncRunId: run._id,
        syncStatus: "failed",
      }),
    ]);

    const remaining = Math.max(0, pending + processing);
    const estimatedSeconds = Math.ceil((remaining * run.requestDelayMs) / 1000);
    const progressPercentage =
      run.totalQueued > 0
        ? Number(((run.processedCount / run.totalQueued) * 100).toFixed(2))
        : 100;

    return NextResponse.json({
      success: true,
      latestRun: {
        id: String(run._id),
        mode: run.mode,
        status: run.status,
        totalQueued: run.totalQueued,
        processedCount: run.processedCount,
        successCount: run.successCount,
        failedCount: run.failedCount,
        retryCount: run.retryCount,
        rateLimitCount: run.rateLimitCount,
        requestDelayMs: run.requestDelayMs,
        maxAttempts: run.maxAttempts,
        progressPercentage,
        estimatedSeconds,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        lastHeartbeatAt: run.lastHeartbeatAt,
        lastAdvertiserId: run.lastAdvertiserId,
        errorCode: run.errorCode,
        errorMessage: run.errorMessage,
      },
      merchants: { pending, processing, completed, failed, remaining },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DETAIL_SYNC_STATUS_FAILED",
          message: "Failed to read detail sync status",
        },
      },
      { status: 500 },
    );
  }
}
