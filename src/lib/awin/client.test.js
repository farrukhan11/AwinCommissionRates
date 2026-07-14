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
  it("lets Awin resolve the relationship by omitting the relationship query parameter", async () => {
    process.env.AWIN_API_TOKEN = "test-token";
    process.env.AWIN_PUBLISHER_ID = "1952827";

    let requestedUrl;
    globalThis.fetch = async (url) => {
      requestedUrl = new URL(String(url));
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

    const result = await getAwinProgramDetails(64110, {
      relationship: "joined",
    });

    assert.equal(requestedUrl.pathname, "/publishers/1952827/programmedetails");
    assert.equal(requestedUrl.searchParams.get("advertiserId"), "64110");
    assert.equal(requestedUrl.searchParams.has("relationship"), false);
    assert.deepEqual(result.commissionRange, [
      { min: 0, max: 8, type: "percentage" },
    ]);
  });
});
