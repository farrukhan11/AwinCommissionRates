import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeAwinProgramDetails } from "./program-details.js";

describe("normalizeAwinProgramDetails", () => {
  it("preserves raw data and extracts programme information", () => {
    const raw = {
      programmeInfo: {
        name: "Example",
        membershipStatus: "joined",
        displayUrl: "https://example.com",
        currencyCode: "GBP",
        primarySector: "Retail",
        primaryRegion: { name: "United Kingdom", countryCode: "GB" },
      },
      commissionRange: [
        { min: 2, max: 5, type: "percentage" },
        { min: 1, max: 8, type: "percentage" },
      ],
      kpi: { epc: 0.5 },
    };

    const result = normalizeAwinProgramDetails(raw);
    assert.deepEqual(result.programmeDetails, raw);
    assert.equal(result.programmeName, "Example");
    assert.equal(result.membershipStatus, "joined");
    assert.equal(result.countryCode, "GB");
    assert.equal(result.commissionMin, 1);
    assert.equal(result.commissionMax, 8);
    assert.equal(result.commissionType, "percentage");
  });

  it("handles malformed responses without throwing", () => {
    const result = normalizeAwinProgramDetails(["unexpected"]);
    assert.deepEqual(result.programmeDetails, ["unexpected"]);
    assert.equal(result.programmeName, undefined);
  });
});
