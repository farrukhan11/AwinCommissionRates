export const AWIN_DETAIL_FETCH_VERSION = 2;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function formatSingleCommissionRange(range, currencyCode) {
  if (!isRecord(range)) return undefined;

  const min = readFiniteNumber(range.min);
  const max = readFiniteNumber(range.max);
  if (min === undefined || max === undefined) return undefined;

  const type = readString(range.type)?.toLowerCase();
  const minText = formatNumber(min);
  const maxText = formatNumber(max);

  if (type === "percentage") {
    return min === max ? `${minText}%` : `${minText}% - ${maxText}%`;
  }

  const currency = currencyCode || "";
  if (min === max) return currency ? `${currency} ${minText}` : minText;
  return currency
    ? `${currency} ${minText} - ${currency} ${maxText}`
    : `${minText} - ${maxText}`;
}

export function formatCommissionRange(commissionRange, currencyCode) {
  if (!Array.isArray(commissionRange) || commissionRange.length === 0) {
    return undefined;
  }

  const formatted = commissionRange
    .map((range) => formatSingleCommissionRange(range, currencyCode))
    .filter(Boolean);

  return formatted.length > 0 ? [...new Set(formatted)].join(" / ") : undefined;
}

export function normalizeAwinProgramDetails(raw) {
  const normalized = {
    programmeDetails: raw,
    detailFetchVersion: AWIN_DETAIL_FETCH_VERSION,
    detailFetchStrategy: "programmedetails-default",
  };

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

  const ranges = Array.isArray(raw.commissionRange)
    ? raw.commissionRange.filter(isRecord)
    : [];
  const mins = ranges
    .map((range) => readFiniteNumber(range.min))
    .filter((value) => value !== undefined);
  const maxes = ranges
    .map((range) => readFiniteNumber(range.max))
    .filter((value) => value !== undefined);
  const types = ranges
    .map((range) => readString(range.type)?.toLowerCase())
    .filter((value) => value !== undefined);

  if (mins.length > 0) normalized.commissionMin = Math.min(...mins);
  if (maxes.length > 0) normalized.commissionMax = Math.max(...maxes);
  if (types.length > 0) normalized.commissionType = [...new Set(types)].join(",");

  const commissionDisplay = formatCommissionRange(
    raw.commissionRange,
    normalized.currencyCode,
  );
  const membershipKey = normalized.membershipStatus
    ?.toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (commissionDisplay) {
    normalized.commissionDisplay = commissionDisplay;
    normalized.commissionFetchStatus = "fetched";
    normalized.commissionUnavailableReason = "";
  } else {
    normalized.commissionDisplay =
      membershipKey === "notjoined" ? "Not disclosed by Awin" : "Not provided";
    normalized.commissionFetchStatus = "unavailable";
    normalized.commissionUnavailableReason =
      membershipKey === "notjoined"
        ? "Awin returned an empty commissionRange for this not-joined programme"
        : "Awin did not provide commissionRange for this programme";
  }

  return normalized;
}
