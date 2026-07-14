function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function normalizeAwinProgramDetails(raw) {
  const normalized = { programmeDetails: raw };

  if (!isRecord(raw)) {
    return normalized;
  }

  normalized.commissionRange = raw.commissionRange;
  normalized.kpi = raw.kpi;
  normalized.programmeInfo = raw.programmeInfo;

  if (isRecord(raw.programmeInfo)) {
    const info = raw.programmeInfo;
    normalized.programmeName = readString(info.name);
    normalized.membershipStatus = readString(info.membershipStatus);
    normalized.displayUrl = readString(info.displayUrl);
    normalized.logoUrl = readString(info.logoUrl);
    normalized.currencyCode = readString(info.currencyCode);
    normalized.sector = readString(info.primarySector);

    if (isRecord(info.primaryRegion)) {
      normalized.primaryRegion = readString(info.primaryRegion.name);
      normalized.countryCode = readString(info.primaryRegion.countryCode);
    }
  }

  if (Array.isArray(raw.commissionRange) && raw.commissionRange.length > 0) {
    const ranges = raw.commissionRange.filter(isRecord);
    const mins = ranges
      .map((range) => readFiniteNumber(range.min))
      .filter((value) => value !== undefined);
    const maxes = ranges
      .map((range) => readFiniteNumber(range.max))
      .filter((value) => value !== undefined);
    const types = ranges
      .map((range) => readString(range.type))
      .filter((value) => value !== undefined);

    if (mins.length > 0) normalized.commissionMin = Math.min(...mins);
    if (maxes.length > 0) normalized.commissionMax = Math.max(...maxes);
    if (types.length > 0) {
      normalized.commissionType = [...new Set(types)].join(",");
    }
  }

  return normalized;
}
