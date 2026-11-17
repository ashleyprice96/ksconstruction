import { describe, expect, it } from "vitest";
import { lineValuePence, percentOfPence, rescale, toPence } from "../../src/lib/money";

describe("money", () => {
  it("multiplies quantity by rate to the penny without float drift", () => {
    expect(lineValuePence(1234, "0.47")).toBe(57998); // 1234 at 47p = £579.98
    expect(lineValuePence("120", "2.10")).toBe(25200);
    expect(lineValuePence(0.1 + 0.2, "100")).toBe(3000);
    expect(lineValuePence(3, "0.335")).toBe(101); // £1.005 rounds to £1.01
  });
  it("takes a percentage of a lift value", () => {
    expect(percentOfPence(65, toPence("2000"))).toBe(130000);
    expect(percentOfPence(33.3, toPence("100"))).toBe(3330);
  });
  it("rescales a split and keeps every penny", () => {
    const out = rescale([18800, 18800], 30001);
    expect(out.reduce((a, b) => a + b, 0)).toBe(30001);
    expect(Math.abs(out[0] - out[1])).toBeLessThanOrEqual(1);
    expect(rescale([10000, 0, 5000], 7500)).toEqual([5000, 0, 2500]);
    expect(rescale([0, 0], 100)).toEqual([0, 0]);
  });
});
