import { AwinApiError } from "./errors";

const AWIN_BASE_URL = "https://api.awin.com";
const DEFAULT_PUBLISHER_ID = "1952827";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_FALLBACK_DELAY_MS = 3_200;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseRetryAfter(headerValue) {
  if (!headerValue) {
    return undefined;
  }

  const seconds = Number.parseInt(headerValue, 10);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }

  const retryDate = Date.parse(headerValue);

  if (Number.isNaN(retryDate)) {
    return undefined;
  }

  const delaySeconds = Math.ceil((retryDate - Date.now()) / 1000);
  return delaySeconds > 0 ? delaySeconds : undefined;
}

function readAwinError(responseData) {
  if (
    typeof responseData !== "object" ||
    responseData === null ||
    Array.isArray(responseData)
  ) {
    return { code: undefined, description: undefined };
  }

  const code =
    typeof responseData.error === "string"
      ? responseData.error.trim()
      : typeof responseData.code === "string"
        ? responseData.code.trim()
        : undefined;
  const description =
    typeof responseData.description === "string"
      ? responseData.description.trim()
      : typeof responseData.message === "string"
        ? responseData.message.trim()
        : undefined;

  return {
    code: code || undefined,
    description: description || undefined,
  };
}

function mapHttpStatusToError(status, retryAfterSeconds, responseData) {
  const awinError = readAwinError(responseData);
  const detailedMessage = [awinError.code, awinError.description]
    .filter(Boolean)
    .join(": ");

  if (awinError.code === "missing.relationship") {
    return new AwinApiError(
      status,
      "AWIN_MISSING_RELATIONSHIP",
      awinError.description || "No relationship exists for this advertiser",
    );
  }

  switch (status) {
    case 401:
      return new AwinApiError(
        401,
        "AWIN_UNAUTHORIZED",
        detailedMessage || "Awin API authentication failed",
      );
    case 403:
      return new AwinApiError(
        403,
        "AWIN_NOT_FOUND",
        detailedMessage ||
          "Awin advertiser programme is not accessible for this publisher",
      );
    case 404:
      return new AwinApiError(
        404,
        "AWIN_NOT_FOUND",
        detailedMessage || "Awin advertiser programme not found",
      );
    case 429:
      return new AwinApiError(
        429,
        "AWIN_RATE_LIMITED",
        detailedMessage || "Awin API rate limit reached",
        retryAfterSeconds,
      );
    default:
      if (status >= 500) {
        return new AwinApiError(
          status,
          "AWIN_SERVER_ERROR",
          detailedMessage || "Awin API server error",
        );
      }

      return new AwinApiError(
        status,
        "AWIN_REQUEST_FAILED",
        detailedMessage || "Awin API request failed",
      );
  }
}

function getPublisherId() {
  return process.env.AWIN_PUBLISHER_ID ?? DEFAULT_PUBLISHER_ID;
}

function getApiToken() {
  const apiToken = process.env.AWIN_API_TOKEN;

  if (!apiToken) {
    throw new AwinApiError(
      500,
      "AWIN_CONFIG_ERROR",
      "Awin API token is not configured",
    );
  }

  return apiToken;
}

function getFallbackDelayMs(options) {
  const value = options?.fallbackDelayMs;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_FALLBACK_DELAY_MS;
  }
  return Math.floor(value);
}

async function awinGet(path, queryParams) {
  const apiToken = getApiToken();
  const url = new URL(`${AWIN_BASE_URL}${path}`);

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    const responseText = await response.text();
    let responseData;

    try {
      responseData = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new AwinApiError(
        502,
        "AWIN_INVALID_RESPONSE",
        "Awin API returned invalid JSON",
      );
    }

    if (!response.ok) {
      const retryAfterSeconds = parseRetryAfter(
        response.headers.get("Retry-After"),
      );

      throw mapHttpStatusToError(
        response.status,
        retryAfterSeconds,
        responseData,
      );
    }

    return responseData;
  } catch (error) {
    if (error instanceof AwinApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AwinApiError(504, "AWIN_TIMEOUT", "Awin API request timed out");
    }

    throw new AwinApiError(
      502,
      "AWIN_REQUEST_FAILED",
      "Awin API request failed",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getAwinProgramDetails(advertiserId, options = {}) {
  if (!Number.isInteger(advertiserId) || advertiserId <= 0) {
    throw new AwinApiError(
      400,
      "AWIN_REQUEST_FAILED",
      "advertiserId must be a positive integer",
    );
  }

  const publisherId = getPublisherId();
  const path = `/publishers/${publisherId}/programmedetails`;
  const baseQuery = { advertiserId: String(advertiserId) };

  // Awin returns joined commissionRange correctly when relationship is omitted.
  // relationship=any can suppress that range, so only use it as a fallback when
  // the default joined lookup explicitly reports missing.relationship.
  try {
    return await awinGet(path, baseQuery);
  } catch (error) {
    if (
      !(error instanceof AwinApiError) ||
      error.code !== "AWIN_MISSING_RELATIONSHIP"
    ) {
      throw error;
    }

    const fallbackDelayMs = getFallbackDelayMs(options);
    if (fallbackDelayMs > 0) {
      await sleep(fallbackDelayMs);
    }

    return awinGet(path, {
      ...baseQuery,
      relationship: "any",
    });
  }
}

export async function getAwinProgrammes(options = {}) {
  const includeHidden = options.includeHidden ?? true;
  const publisherId = getPublisherId();
  const responseData = await awinGet(`/publishers/${publisherId}/programmes`, {
    includeHidden: String(includeHidden),
  });

  if (!Array.isArray(responseData)) {
    throw new AwinApiError(
      502,
      "AWIN_INVALID_RESPONSE",
      "Awin API programmes response is not an array",
    );
  }

  return responseData;
}
