import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getAwinProgramDetails } from "./client.js";

const originalFetch = globalThis.fetch;
const originalToken = process.env.AWIN_API_TOKEN;
const originalPublisherId = process.env.AWIN_PUBLISHER_ID;

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalToken === undefined) delete process.env.AWIN_API_TOKEN;
  else process.env.AWIN_API_TOKEN = originalToken;

  if (originalPublisherId === undefined) delete process.env.AWIN_PUBLISHER_ID;
  else process.env.AWIN_PUBLISHER_ID = originalPublisherId;
});

describe("getAwinProgramDetails", () => {
  it("preserves joined commission ranges by omitting relationship on the first request", async () => {
    process.env.AWIN_API_TOKEN = "test-token";
    process.env.AWIN_PUBLISHER_ID = "1952827";

    const requestedUrls = [];
    globalThis.fetch = async (url) => {
      requestedUrls.push(new URL(String(url)));
      return new Response(
        JSON.stringify({
          programmeInfo: { id: 64110, membershipStatus: "Joined" },
          commissionRange: [{ min: 0, max: 8, type: "percentage" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const result = await getAwinProgramDetails(64110, { fallbackDelayMs: 0 });

    assert.equal(requestedUrls.length, 1);
    assert.equal(
      requestedUrls[0].pathname,
      "/publishers/1952827/programmedetails",
    );
    assert.equal(requestedUrls[0].searchParams.get("advertiserId"), "64110");
    assert.equal(requestedUrls[0].searchParams.has("relationship"), false);
    assert.deepEqual(result.commissionRange, [
      { min: 0, max: 8, type: "percentage" },
    ]);
  });

  it("falls back to relationship=any only after missing.relationship", async () => {
    process.env.AWIN_API_TOKEN = "test-token";
    process.env.AWIN_PUBLISHER_ID = "1952827";

    const requestedUrls = [];
    globalThis.fetch = async (url) => {
      const requestedUrl = new URL(String(url));
      requestedUrls.push(requestedUrl);

      if (!requestedUrl.searchParams.has("relationship")) {
        return new Response(
          JSON.stringify({
            error: "missing.relationship",
            description:
              "No relationship exists between publisherId 1952827 and advertiserId 94973",
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          programmeInfo: { id: 94973, membershipStatus: "Not joined" },
          commissionRange: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const result = await getAwinProgramDetails(94973, { fallbackDelayMs: 0 });

    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[0].searchParams.has("relationship"), false);
    assert.equal(requestedUrls[1].searchParams.get("relationship"), "any");
    assert.equal(result.programmeInfo.membershipStatus, "Not joined");
    assert.deepEqual(result.commissionRange, []);
  });

  it("does not hide non-relationship authorization errors behind the fallback", async () => {
    process.env.AWIN_API_TOKEN = "test-token";
    process.env.AWIN_PUBLISHER_ID = "1952827";

    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      return new Response(
        JSON.stringify({
          error: "forbidden",
          description: "Publisher access is forbidden",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    await assert.rejects(
      () => getAwinProgramDetails(3, { fallbackDelayMs: 0 }),
      (error) => {
        assert.equal(error.code, "AWIN_NOT_FOUND");
        assert.match(error.message, /forbidden/i);
        return true;
      },
    );
    assert.equal(requestCount, 1);
  });
});
