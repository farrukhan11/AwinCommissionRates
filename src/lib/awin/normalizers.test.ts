import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deduplicateProgrammes,
  normalizeAwinProgramme,
} from "./normalizers.ts";

describe("normalizeAwinProgramme", () => {
  it("accepts a valid programme with id", () => {
    const result = normalizeAwinProgramme({
      id: 55541,
      name: "Example Programme",
      membershipStatus: "joined",
    });

    assert.equal(result.valid, true);

    if (result.valid) {
      assert.equal(result.programme.advertiserId, 55541);
      assert.equal(result.programme.programmeName, "Example Programme");
      assert.equal(result.programme.membershipStatus, "joined");
      assert.deepEqual(result.programme.basicProgrammeInfo, {
        id: 55541,
        name: "Example Programme",
        membershipStatus: "joined",
      });
    }
  });

  it("accepts a valid programme with advertiserId", () => {
    const result = normalizeAwinProgramme({
      advertiserId: 123,
      programmeName: "Alt Programme",
    });

    assert.equal(result.valid, true);

    if (result.valid) {
      assert.equal(result.programme.advertiserId, 123);
      assert.equal(result.programme.programmeName, "Alt Programme");
    }
  });

  it("rejects a programme with a missing advertiser ID", () => {
    const result = normalizeAwinProgramme({
      name: "No ID Programme",
    });

    assert.equal(result.valid, false);

    if (!result.valid) {
      assert.match(result.reason, /advertiser ID/i);
    }
  });

  it("rejects a programme with a negative advertiser ID", () => {
    const result = normalizeAwinProgramme({
      id: -10,
      name: "Invalid Programme",
    });

    assert.equal(result.valid, false);
  });

  it("allows optional fields to be absent", () => {
    const result = normalizeAwinProgramme({ id: 42 });

    assert.equal(result.valid, true);

    if (result.valid) {
      assert.equal(result.programme.programmeName, undefined);
      assert.equal(result.programme.membershipStatus, undefined);
      assert.equal(result.programme.displayUrl, undefined);
    }
  });

  it("handles nested and alternative field names safely", () => {
    const result = normalizeAwinProgramme({
      advertiser: { id: 77 },
      relationship: "notjoined",
      status: "active",
      url: "https://example.com",
      logo: "https://example.com/logo.png",
      currency: "GBP",
      country: "GB",
      primaryRegion: "UK",
      sector: "Retail",
      isHidden: true,
    });

    assert.equal(result.valid, true);

    if (result.valid) {
      assert.equal(result.programme.advertiserId, 77);
      assert.equal(result.programme.membershipStatus, "notjoined");
      assert.equal(result.programme.programmeStatus, "active");
      assert.equal(result.programme.displayUrl, "https://example.com");
      assert.equal(result.programme.logoUrl, "https://example.com/logo.png");
      assert.equal(result.programme.currencyCode, "GBP");
      assert.equal(result.programme.countryCode, "GB");
      assert.equal(result.programme.primaryRegion, "UK");
      assert.equal(result.programme.sector, "Retail");
      assert.equal(result.programme.isHidden, true);
    }
  });

  it("preserves the raw programme object", () => {
    const rawProgramme = {
      id: 99,
      nested: { value: "keep-me" },
      list: [1, 2, 3],
    };

    const result = normalizeAwinProgramme(rawProgramme);

    assert.equal(result.valid, true);

    if (result.valid) {
      assert.deepEqual(result.programme.basicProgrammeInfo, rawProgramme);
    }
  });
});

describe("deduplicateProgrammes", () => {
  it("keeps the last programme for duplicate advertiser IDs", () => {
    const deduplicated = deduplicateProgrammes([
      {
        advertiserId: 10,
        programmeName: "First",
        basicProgrammeInfo: { id: 10, name: "First" },
      },
      {
        advertiserId: 10,
        programmeName: "Second",
        basicProgrammeInfo: { id: 10, name: "Second" },
      },
      {
        advertiserId: 11,
        programmeName: "Unique",
        basicProgrammeInfo: { id: 11, name: "Unique" },
      },
    ]);

    assert.equal(deduplicated.length, 2);
    assert.equal(
      deduplicated.find((programme) => programme.advertiserId === 10)
        ?.programmeName,
      "Second",
    );
  });
});
