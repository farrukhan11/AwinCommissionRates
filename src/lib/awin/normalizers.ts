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
  | {
      valid: true;
      programme: NormalizedAwinProgramme;
    }
  | {
      valid: false;
      reason: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getFirstValue(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    const value = record[key];

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function extractAdvertiserId(
  record: Record<string, unknown>,
): number | undefined {
  const directId = toPositiveInteger(getFirstValue(record, ["id", "advertiserId"]));

  if (directId !== undefined) {
    return directId;
  }

  const nestedAdvertiser = getFirstValue(record, ["advertiser"]);

  if (isRecord(nestedAdvertiser)) {
    return toPositiveInteger(
      getFirstValue(nestedAdvertiser, ["id", "advertiserId"]),
    );
  }

  return undefined;
}

export function normalizeAwinProgramme(
  rawProgramme: unknown,
): NormalizeAwinProgrammeResult {
  if (!isRecord(rawProgramme)) {
    return {
      valid: false,
      reason: "Programme record is not an object",
    };
  }

  const advertiserId = extractAdvertiserId(rawProgramme);

  if (advertiserId === undefined) {
    return {
      valid: false,
      reason: "Missing or invalid advertiser ID",
    };
  }

  const programme: NormalizedAwinProgramme = {
    advertiserId,
    basicProgrammeInfo: rawProgramme,
  };

  const programmeName = readString(
    getFirstValue(rawProgramme, ["name", "programmeName"]),
  );

  if (programmeName !== undefined) {
    programme.programmeName = programmeName;
  }

  const membershipStatus = readString(
    getFirstValue(rawProgramme, ["membershipStatus", "relationship"]),
  );

  if (membershipStatus !== undefined) {
    programme.membershipStatus = membershipStatus;
  }

  const programmeStatus = readString(
    getFirstValue(rawProgramme, ["status", "programmeStatus"]),
  );

  if (programmeStatus !== undefined) {
    programme.programmeStatus = programmeStatus;
  }

  const primaryRegion = readString(rawProgramme.primaryRegion);

  if (primaryRegion !== undefined) {
    programme.primaryRegion = primaryRegion;
  }

  const countryCode = readString(
    getFirstValue(rawProgramme, ["countryCode", "country"]),
  );

  if (countryCode !== undefined) {
    programme.countryCode = countryCode;
  }

  const currencyCode = readString(
    getFirstValue(rawProgramme, ["currencyCode", "currency"]),
  );

  if (currencyCode !== undefined) {
    programme.currencyCode = currencyCode;
  }

  const sector = readString(rawProgramme.sector);

  if (sector !== undefined) {
    programme.sector = sector;
  }

  const displayUrl = readString(
    getFirstValue(rawProgramme, ["displayUrl", "url"]),
  );

  if (displayUrl !== undefined) {
    programme.displayUrl = displayUrl;
  }

  const logoUrl = readString(getFirstValue(rawProgramme, ["logoUrl", "logo"]));

  if (logoUrl !== undefined) {
    programme.logoUrl = logoUrl;
  }

  const isHidden = readBoolean(rawProgramme.isHidden);

  if (isHidden !== undefined) {
    programme.isHidden = isHidden;
  }

  return {
    valid: true,
    programme,
  };
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

  if (programme.programmeName !== undefined) {
    setFields.programmeName = programme.programmeName;
  }

  if (programme.membershipStatus !== undefined) {
    setFields.membershipStatus = programme.membershipStatus;
  }

  if (programme.programmeStatus !== undefined) {
    setFields.programmeStatus = programme.programmeStatus;
  }

  if (programme.primaryRegion !== undefined) {
    setFields.primaryRegion = programme.primaryRegion;
  }

  if (programme.countryCode !== undefined) {
    setFields.countryCode = programme.countryCode;
  }

  if (programme.currencyCode !== undefined) {
    setFields.currencyCode = programme.currencyCode;
  }

  if (programme.sector !== undefined) {
    setFields.sector = programme.sector;
  }

  if (programme.displayUrl !== undefined) {
    setFields.displayUrl = programme.displayUrl;
  }

  if (programme.logoUrl !== undefined) {
    setFields.logoUrl = programme.logoUrl;
  }

  if (programme.isHidden !== undefined) {
    setFields.isHidden = programme.isHidden;
  }

  return {
    updateOne: {
      filter: {
        advertiserId: programme.advertiserId,
      },
      update: {
        $set: setFields,
        $setOnInsert: {
          syncStatus: "pending" as const,
          syncAttempts: 0,
        },
      },
      upsert: true,
    },
  };
}
