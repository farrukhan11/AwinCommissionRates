import { NextResponse } from "next/server";

import { isValidAdminApiKey } from "@/lib/auth/admin-api-key";
import { connectToDatabase } from "@/lib/mongodb";
import AwinMerchant from "@/models/AwinMerchant";

export const runtime = "nodejs";

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

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
    const merchants = await AwinMerchant.find()
      .sort({ advertiserId: 1 })
      .select(
        "advertiserId programmeName membershipStatus programmeStatus countryCode currencyCode sector displayUrl directoryImportStatus syncStatus commissionMin commissionMax commissionType detailsFetchedAt lastSyncError",
      )
      .lean();

    const headers = [
      "advertiserId",
      "programmeName",
      "membershipStatus",
      "programmeStatus",
      "countryCode",
      "currencyCode",
      "sector",
      "displayUrl",
      "directoryImportStatus",
      "syncStatus",
      "commissionMin",
      "commissionMax",
      "commissionType",
      "detailsFetchedAt",
      "lastSyncError",
    ];

    const rows = [
      headers.join(","),
      ...merchants.map((merchant) =>
        headers.map((header) => csvCell(merchant[header])).join(","),
      ),
    ];

    return new NextResponse(rows.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="awin-merchants-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "EXPORT_FAILED", message: "Failed to export merchants" },
      },
      { status: 500 },
    );
  }
}
