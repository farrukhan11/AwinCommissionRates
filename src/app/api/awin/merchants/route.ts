import { NextRequest, NextResponse } from "next/server";
import type { FilterQuery } from "mongoose";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant, { type IAwinMerchant } from "@/models/AwinMerchant";

export const runtime = "nodejs";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: NextRequest) {
  if (!isValidAdminApiKey(request.headers.get("x-admin-api-key"))) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" } },
      { status: 401 },
    );
  }

  try {
    await connectToDatabase();
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(params.get("limit") ?? "25", 10) || 25));
    const search = params.get("search")?.trim();
    const syncStatus = params.get("syncStatus");
    const directoryStatus = params.get("directoryStatus");
    const countryCode = params.get("countryCode")?.trim().toUpperCase();
    const membershipStatus = params.get("membershipStatus")?.trim();

    const filter: FilterQuery<IAwinMerchant> = {};
    if (search) {
      const numericId = Number(search);
      filter.$or = [
        { programmeName: { $regex: escapeRegex(search), $options: "i" } },
        ...(Number.isInteger(numericId) && numericId > 0 ? [{ advertiserId: numericId }] : []),
      ];
    }
    if (["pending", "processing", "completed", "failed"].includes(syncStatus ?? "")) {
      filter.syncStatus = syncStatus;
    }
    if (["discovered", "active", "missing"].includes(directoryStatus ?? "")) {
      filter.directoryImportStatus = directoryStatus;
    }
    if (countryCode) filter.countryCode = countryCode;
    if (membershipStatus) filter.membershipStatus = membershipStatus;

    const [total, merchants] = await Promise.all([
      AwinMerchant.countDocuments(filter),
      AwinMerchant.find(filter)
        .sort({ programmeName: 1, advertiserId: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(
          "advertiserId programmeName membershipStatus programmeStatus countryCode currencyCode sector displayUrl logoUrl directoryImportStatus syncStatus syncAttempts detailRunAttempts detailsFetchedAt commissionMin commissionMax commissionType kpi lastSyncError updatedAt",
        )
        .lean(),
    ]);

    return NextResponse.json({
      success: true,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      merchants: merchants.map((merchant) => ({ ...merchant, id: String(merchant._id), _id: undefined })),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "MERCHANT_LIST_FAILED", message: "Failed to load merchants" } },
      { status: 500 },
    );
  }
}
