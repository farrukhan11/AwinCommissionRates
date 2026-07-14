import { AwinApiError } from "./errors";

const AWIN_BASE_URL = "https://api.awin.com";
const DEFAULT_PUBLISHER_ID = "1952827";
const REQUEST_TIMEOUT_MS = 30_000;

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

function mapHttpStatusToError(status, retryAfterSeconds) {
  switch (status) {
    case 401:
      return new AwinApiError(
        401,
        "AWIN_UNAUTHORIZED",
        "Awin API authentication failed",
      );
    case 403:
      return new AwinApiError(
        403,
        "AWIN_FORBIDDEN",
        "Awin API access forbidden",
      );
    case 404:
      return new AwinApiError(
        404,
        "AWIN_NOT_FOUND",
        "Awin advertiser programme not found",
      );
    case 429:
      return new AwinApiError(
        429,
        "AWIN_RATE_LIMITED",
        "Awin API rate limit reached",
        retryAfterSeconds,
      );
    default:
      if (status >= 500) {
        return new AwinApiError(
          status,
          "AWIN_SERVER_ERROR",
          "Awin API server error",
        );
      }

      return new AwinApiError(
        status,
        "AWIN_REQUEST_FAILED",
        "Awin API request failed",
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

      throw mapHttpStatusToError(response.status, retryAfterSeconds);
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

export async function getAwinProgramDetails(advertiserId) {
  if (!Number.isInteger(advertiserId) || advertiserId <= 0) {
    throw new AwinApiError(
      400,
      "AWIN_REQUEST_FAILED",
      "advertiserId must be a positive integer",
    );
  }

  const publisherId = getPublisherId();

  // Do not send relationship=joined/any/notjoined here. Awin's default
  // resolution returns the current programme relationship and, where exposed,
  // the commissionRange. This matches the working Postman request.
  return awinGet(`/publishers/${publisherId}/programmedetails`, {
    advertiserId: String(advertiserId),
  });
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
