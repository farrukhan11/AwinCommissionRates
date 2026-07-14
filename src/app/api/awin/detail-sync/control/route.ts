import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant from "@/models/AwinMerchant";
import AwinDetailSyncRun from "@/models/AwinDetailSyncRun";

export const runtime = "nodejs";

type ControlAction = "pause" | "resume" | "cancel";

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

  const action = isRecord(body) ? body.action : undefined;
  const runId = isRecord(body) ? body.runId : undefined;
  const allowedActions: ControlAction[] = ["pause", "resume", "cancel"];

  if (!allowedActions.includes(action as ControlAction)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_REQUEST", message: "action must be pause, resume, or cancel" } },
      { status: 400 },
    );
  }

  if (runId !== undefined && (typeof runId !== "string" || !Types.ObjectId.isValid(runId))) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_REQUEST", message: "Invalid runId" } },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();

    const run = runId
      ? await AwinDetailSyncRun.findById(runId)
      : await AwinDetailSyncRun.findOne({ activeLock: "global" }).sort({ createdAt: -1 });

    if (!run) {
      return NextResponse.json(
        { success: false, error: { code: "RUN_NOT_FOUND", message: "No active detail sync run found" } },
        { status: 404 },
      );
    }

    if (action === "pause") {
      if (!['pending', 'running'].includes(run.status)) {
        return NextResponse.json(
          { success: false, error: { code: "INVALID_RUN_STATE", message: `Cannot pause a ${run.status} run` } },
          { status: 409 },
        );
      }
      run.status = "paused";
      run.leaseExpiresAt = new Date();
    }

    if (action === "resume") {
      if (run.status !== "paused") {
        return NextResponse.json(
          { success: false, error: { code: "INVALID_RUN_STATE", message: `Cannot resume a ${run.status} run` } },
          { status: 409 },
        );
      }
      run.status = "pending";
      run.workerId = undefined;
      run.leaseExpiresAt = undefined;
    }

    if (action === "cancel") {
      if (["completed", "completed_with_errors", "failed", "cancelled"].includes(run.status)) {
        return NextResponse.json(
          { success: false, error: { code: "INVALID_RUN_STATE", message: `Cannot cancel a ${run.status} run` } },
          { status: 409 },
        );
      }
      run.status = "cancelled";
      run.completedAt = new Date();
      run.activeLock = undefined;
      run.workerId = undefined;
      run.leaseExpiresAt = undefined;

      await AwinMerchant.updateMany(
        { detailSyncRunId: run._id, syncStatus: "processing" },
        {
          $set: { syncStatus: "pending" },
          $unset: { detailSyncLockedAt: "", nextRetryAt: "" },
        },
      );
    }

    await run.save();

    return NextResponse.json({
      success: true,
      runId: String(run._id),
      action,
      status: run.status,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "DETAIL_SYNC_CONTROL_FAILED", message: "Failed to update detail sync run" },
      },
      { status: 500 },
    );
  }
}
