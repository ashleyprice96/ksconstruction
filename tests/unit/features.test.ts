import { afterEach, describe, expect, it } from "vitest";
import { claimsEnabled, claimsPathBlocked, productName } from "../../src/lib/features";

describe("claims feature flag", () => {
  const previous = process.env.FEATURE_CLAIMS;

  afterEach(() => {
    if (previous === undefined) delete process.env.FEATURE_CLAIMS;
    else process.env.FEATURE_CLAIMS = previous;
  });

  it("hides claims unless FEATURE_CLAIMS is exactly true", () => {
    delete process.env.FEATURE_CLAIMS;
    expect(claimsEnabled()).toBe(false);
    expect(productName()).toBe("K-S H&S");
    expect(claimsPathBlocked("/claims")).toBe(true);
    expect(claimsPathBlocked("/claims/new")).toBe(true);
    expect(claimsPathBlocked("/payments")).toBe(true);
    expect(claimsPathBlocked("/rates")).toBe(true);
    expect(claimsPathBlocked("/commercial")).toBe(true);
    expect(claimsPathBlocked("/api/files/abc")).toBe(true);
    expect(claimsPathBlocked("/")).toBe(false);
    expect(claimsPathBlocked("/safety")).toBe(false);
    expect(claimsPathBlocked("/setup")).toBe(false);

    process.env.FEATURE_CLAIMS = "false";
    expect(claimsEnabled()).toBe(false);

    process.env.FEATURE_CLAIMS = "true";
    expect(claimsEnabled()).toBe(true);
    expect(productName()).toBe("K-S Claims");
    expect(claimsPathBlocked("/claims")).toBe(false);
    expect(claimsPathBlocked("/payments/mine")).toBe(false);
  });
});
