import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatCommissionRange,
  normalizeAwinProgramDetails,
} from "./program-details.js";

describe("formatCommissionRange", () => {
  it("formats percentage ranges supplied as strings", () => {
    assert.equal(
      formatCommissionRange(
        [{ min: "5", max: "10", type: "percentage" }],
        "GBP",
      ),
      "5% - 10%",
    );
  });

  it("formats fixed ranges with currency", () => {
    assert.equal(
      formatCommissionRange([{ min: "2", max: "2", type: "fixed" }], "GBP"),
      "GBP 2",
    );
  });
});

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
        { min: "2", max: "5", type: "percentage" },
        { min: "1", max: "8", type: "percentage" },
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
    assert.equal(result.commissionDisplay, "2% - 5% / 1% - 8%");
    assert.equal(result.commissionFetchStatus, "fetched");
  });

  it("marks a not-joined programme without a range as unavailable", () => {
    const result = normalizeAwinProgramDetails({
      programmeInfo: {
        id: 3,
        name: "Awin",
        membershipStatus: "Not joined",
      },
    });

    assert.equal(result.commissionDisplay, "Not available (not joined)");
    assert.equal(result.commissionFetchStatus, "unavailable");
  });

  it("handles malformed responses without throwing", () => {
    const result = normalizeAwinProgramDetails(["unexpected"]);
    assert.deepEqual(result.programmeDetails, ["unexpected"]);
    assert.equal(result.programmeName, undefined);
  });
});
