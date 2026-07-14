import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import AwinDetailSyncRun from "@/models/AwinDetailSyncRun";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectToDatabase();
    const activeRun = await AwinDetailSyncRun.findOne({
      status: { $in: ["pending", "running", "paused"] },
    })
      .sort({ createdAt: -1 })
      .select("status lastHeartbeatAt leaseExpiresAt")
      .lean();

    const heartbeatAgeSeconds = activeRun?.lastHeartbeatAt
      ? Math.max(0, Math.floor((Date.now() - activeRun.lastHeartbeatAt.getTime()) / 1000))
      : null;

    return NextResponse.json({
      status: "ok",
      database: "connected",
      detailWorker: activeRun
        ? {
            runStatus: activeRun.status,
            heartbeatAgeSeconds,
            healthy:
              activeRun.status !== "running" ||
              (heartbeatAgeSeconds !== null && heartbeatAgeSeconds < 180),
          }
        : { runStatus: "idle", healthy: true },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
