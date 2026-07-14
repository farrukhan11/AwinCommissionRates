function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInteger(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }

  return undefined;
}

function readString(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function readBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function getFirstValue(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function extractAdvertiserId(record) {
  const directId = toPositiveInteger(
    getFirstValue(record, ["id", "advertiserId"]),
  );
  if (directId !== undefined) return directId;

  const nestedAdvertiser = record.advertiser;
  return isRecord(nestedAdvertiser)
    ? toPositiveInteger(
        getFirstValue(nestedAdvertiser, ["id", "advertiserId"]),
      )
    : undefined;
}

export function normalizeAwinProgramme(rawProgramme) {
  if (!isRecord(rawProgramme)) {
    return { valid: false, reason: "Programme record is not an object" };
  }

  const advertiserId = extractAdvertiserId(rawProgramme);
  if (advertiserId === undefined) {
    return { valid: false, reason: "Missing or invalid advertiser ID" };
  }

  const programme = {
    advertiserId,
    basicProgrammeInfo: rawProgramme,
  };

  const stringMappings = [
    ["programmeName", getFirstValue(rawProgramme, ["name", "programmeName"])],
    [
      "membershipStatus",
      getFirstValue(rawProgramme, ["membershipStatus", "relationship"]),
    ],
    [
      "programmeStatus",
      getFirstValue(rawProgramme, ["status", "programmeStatus"]),
    ],
    [
      "currencyCode",
      getFirstValue(rawProgramme, ["currencyCode", "currency"]),
    ],
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
    const countryCode = readString(
      getFirstValue(rawProgramme, ["countryCode", "country"]),
    );
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

export function deduplicateProgrammes(programmes) {
  const programmesByAdvertiserId = new Map();
  for (const programme of programmes) {
    programmesByAdvertiserId.set(programme.advertiserId, programme);
  }
  return Array.from(programmesByAdvertiserId.values());
}

export function buildMerchantBulkOperation(programme, importStartedAt) {
  const setFields = {
    basicProgrammeInfo: programme.basicProgrammeInfo,
    programmeListFetchedAt: importStartedAt,
    lastSeenInProgrammeListAt: importStartedAt,
    directoryImportStatus: "active",
  };

  const optionalFields = [
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
      setFields[key] = value;
    }
  }

  return {
    updateOne: {
      filter: { advertiserId: programme.advertiserId },
      update: {
        $set: setFields,
        $setOnInsert: {
          syncStatus: "pending",
          syncAttempts: 0,
          detailRunAttempts: 0,
        },
      },
      upsert: true,
    },
  };
}
