import { describe, expect, it } from "vitest";
import { weekEndingFor } from "../../src/lib/dates";

const cutoff = { weekday: 5, time: "11:00", timezone: "Europe/London" };

describe("weekly cut-off (default 11:00 Friday, UK time)", () => {
  it("counts Monday to Friday before 11:00 in this week", () => {
    expect(weekEndingFor(new Date("2026-11-09T09:00:00Z"), cutoff)).toBe("2026-11-13"); // Monday
    expect(weekEndingFor(new Date("2026-11-13T10:59:00Z"), cutoff)).toBe("2026-11-13"); // Friday 10:59 GMT
  });
  it("rolls Friday from 11:00, and the weekend, to next week", () => {
    expect(weekEndingFor(new Date("2026-11-13T11:00:00Z"), cutoff)).toBe("2026-11-20");
    expect(weekEndingFor(new Date("2026-11-14T08:00:00Z"), cutoff)).toBe("2026-11-20"); // Saturday
    expect(weekEndingFor(new Date("2026-11-15T23:30:00Z"), cutoff)).toBe("2026-11-20"); // Sunday night
  });
  it("uses UK local time in summer (BST)", () => {
    // 10:30 UTC on a Friday in July is 11:30 BST: after the cut-off.
    expect(weekEndingFor(new Date("2026-07-17T10:30:00Z"), cutoff)).toBe("2026-07-24");
    expect(weekEndingFor(new Date("2026-07-17T09:59:00Z"), cutoff)).toBe("2026-07-17");
  });
  it("follows a configured cut-off", () => {
    expect(weekEndingFor(new Date("2026-11-11T12:00:00Z"), { ...cutoff, weekday: 3, time: "12:00" })).toBe("2026-11-18");
  });
});
