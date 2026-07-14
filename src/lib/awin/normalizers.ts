import type { AnyBulkWriteOperation } from "mongoose";

import type { IAwinMerchant } from "@/models/AwinMerchant";

export interface NormalizedAwinProgramme {
  advertiserId: number;
  programmeName?: string;
  membershipStatus?: string;
  programmeStatus?: string;
  primaryRegion?: string;
  countryCode?: string;
  currencyCode?: string;
  sector?: string;
  displayUrl?: string;
  logoUrl?: string;
  isHidden?: boolean;
  basicProgrammeInfo: unknown;
}

export type NormalizeAwinProgrammeResult =
  | { valid: true; programme: NormalizedAwinProgramme }
  | { valid: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }

  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getFirstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function extractAdvertiserId(record: Record<string, unknown>): number | undefined {
  const directId = toPositiveInteger(getFirstValue(record, ["id", "advertiserId"]));
  if (directId !== undefined) return directId;

  const nestedAdvertiser = record.advertiser;
  return isRecord(nestedAdvertiser)
    ? toPositiveInteger(getFirstValue(nestedAdvertiser, ["id", "advertiserId"]))
    : undefined;
}

export function normalizeAwinProgramme(rawProgramme: unknown): NormalizeAwinProgrammeResult {
  if (!isRecord(rawProgramme)) {
    return { valid: false, reason: "Programme record is not an object" };
  }

  const advertiserId = extractAdvertiserId(rawProgramme);
  if (advertiserId === undefined) {
    return { valid: false, reason: "Missing or invalid advertiser ID" };
  }

  const programme: NormalizedAwinProgramme = {
    advertiserId,
    basicProgrammeInfo: rawProgramme,
  };

  const stringMappings: Array<[
    keyof Pick<
      NormalizedAwinProgramme,
      | "programmeName"
      | "membershipStatus"
      | "programmeStatus"
      | "currencyCode"
      | "sector"
      | "displayUrl"
      | "logoUrl"
    >,
    unknown,
  ]> = [
    ["programmeName", getFirstValue(rawProgramme, ["name", "programmeName"])],
    ["membershipStatus", getFirstValue(rawProgramme, ["membershipStatus", "relationship"])],
    ["programmeStatus", getFirstValue(rawProgramme, ["status", "programmeStatus"])],
    ["currencyCode", getFirstValue(rawProgramme, ["currencyCode", "currency"])],
    ["sector", getFirstValue(rawProgramme, ["primarySector", "sector"])],
    ["displayUrl", getFirstValue(rawProgramme, ["displayUrl", "url"])],
    ["logoUrl", getFirstValue(rawProgramme, ["logoUrl", "logo"])],
  ];

  for (const [key, rawValue] of stringMappings) {
    const value = readString(rawValue);
    if (value !== undefined) programme[key] = value;
  }

  const primaryRegion = rawProgramme.primaryRegion;
  if (isRecord(primaryRegion)) {
    const regionName = readString(primaryRegion.name);
    const countryCode = readString(primaryRegion.countryCode);
    if (regionName) programme.primaryRegion = regionName;
    if (countryCode) programme.countryCode = countryCode;
  } else {
    const regionName = readString(primaryRegion);
    if (regionName) programme.primaryRegion = regionName;
  }

  if (!programme.countryCode) {
    const countryCode = readString(getFirstValue(rawProgramme, ["countryCode", "country"]));
    if (countryCode) programme.countryCode = countryCode;
  }

  const explicitHidden = readBoolean(rawProgramme.isHidden);
  if (explicitHidden !== undefined) {
    programme.isHidden = explicitHidden;
  } else if (programme.programmeStatus) {
    programme.isHidden = programme.programmeStatus.toLowerCase() === "hidden";
  }

  return { valid: true, programme };
}

export function deduplicateProgrammes(
  programmes: NormalizedAwinProgramme[],
): NormalizedAwinProgramme[] {
  const programmesByAdvertiserId = new Map<number, NormalizedAwinProgramme>();
  for (const programme of programmes) {
    programmesByAdvertiserId.set(programme.advertiserId, programme);
  }
  return Array.from(programmesByAdvertiserId.values());
}

export function buildMerchantBulkOperation(
  programme: NormalizedAwinProgramme,
  importStartedAt: Date,
): AnyBulkWriteOperation<IAwinMerchant> {
  const setFields: Partial<IAwinMerchant> = {
    basicProgrammeInfo: programme.basicProgrammeInfo,
    programmeListFetchedAt: importStartedAt,
    lastSeenInProgrammeListAt: importStartedAt,
    directoryImportStatus: "active",
  };

  const optionalFields: Array<keyof NormalizedAwinProgramme> = [
    "programmeName",
    "membershipStatus",
    "programmeStatus",
    "primaryRegion",
    "countryCode",
    "currencyCode",
    "sector",
    "displayUrl",
    "logoUrl",
    "isHidden",
  ];

  for (const key of optionalFields) {
    const value = programme[key];
    if (value !== undefined) {
      (setFields as Record<string, unknown>)[key] = value;
    }
  }

  return {
    updateOne: {
      filter: { advertiserId: programme.advertiserId },
      update: {
        $set: setFields,
        $setOnInsert: {
          syncStatus: "pending" as const,
          syncAttempts: 0,
          detailRunAttempts: 0,
        },
      },
      upsert: true,
    },
  };
}
