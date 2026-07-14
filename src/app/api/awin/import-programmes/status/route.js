import { NextResponse } from "next/server";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant from "@/models/AwinMerchant";
import AwinSyncRun from "@/models/AwinSyncRun";

export const runtime = "nodejs";

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

export async function GET(request) {
  if (!isValidAdminApiKey(request.headers.get("x-admin-api-key"))) {
    return unauthorizedResponse();
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

  const latestRun = await AwinSyncRun.findOne({
    type: "programme-directory-import",
  })
    .sort({ createdAt: -1 })
    .select(
      "status totalReceived validProgrammes invalidProgrammes startedAt completedAt errorCode errorMessage",
    )
    .lean();

  const [
    total,
    active,
    missing,
    pendingDetails,
    completedDetails,
    failedDetails,
  ] = await Promise.all([
    AwinMerchant.countDocuments(),
    AwinMerchant.countDocuments({ directoryImportStatus: "active" }),
    AwinMerchant.countDocuments({ directoryImportStatus: "missing" }),
    AwinMerchant.countDocuments({ syncStatus: "pending" }),
    AwinMerchant.countDocuments({ syncStatus: "completed" }),
    AwinMerchant.countDocuments({ syncStatus: "failed" }),
  ]);

  return NextResponse.json({
    success: true,
    latestRun: latestRun
      ? {
          status: latestRun.status,
          totalReceived: latestRun.totalReceived,
          validProgrammes: latestRun.validProgrammes,
          invalidProgrammes: latestRun.invalidProgrammes,
          startedAt: latestRun.startedAt,
          completedAt: latestRun.completedAt,
          ...(latestRun.errorCode && { errorCode: latestRun.errorCode }),
          ...(latestRun.errorMessage && {
            errorMessage: latestRun.errorMessage,
          }),
        }
      : null,
    merchants: {
      total,
      active,
      missing,
      pendingDetails,
      completedDetails,
      failedDetails,
    },
  });
}
