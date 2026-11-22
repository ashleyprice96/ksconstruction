import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { shareSignedSubject } from "../../src/lib/mail";
import { renderSignedCopy } from "../../src/lib/share-pdf";
import type { ShareSignature } from "../../src/lib/share";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function person(name: string, company = ""): ShareSignature {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    full_name: name,
    company,
    signed_at: "2026-11-22T12:00:00.000Z",
    ip: "203.0.113.10",
    user_agent: "test",
    signature_png: PNG,
    user_id: null,
  };
}

describe("signed copy record", () => {
  it("builds a cover, every PDF page, and the signature register", async () => {
    const src = await PDFDocument.create();
    src.addPage().drawText("Page one of the RAMS");
    src.addPage().drawText("Page two of the RAMS");
    const bytes = Buffer.from(await src.save());
    const pdf = await renderSignedCopy({
      kindLabel: "RAMS",
      title: "Ladder check",
      site: "North Yard",
      createdAt: "2026-11-22T09:00:00.000Z",
      version: 1,
      sha256: "ab".repeat(32),
      body: "",
      mime: "application/pdf",
      bytes,
      people: [person("Pat Tester", "Example Gang")],
    });
    const out = await PDFDocument.load(pdf);
    expect(out.getPageCount()).toBe(4);
  });

  it("renders alert text when there is no file", async () => {
    const pdf = await renderSignedCopy({
      kindLabel: "Safety alert",
      title: "Wet walkways",
      site: null,
      createdAt: new Date("2026-11-22T09:00:00.000Z"),
      version: 2,
      sha256: null,
      body: "Keep to the marked path.",
      mime: null,
      bytes: null,
      people: [person("Pat Tester")],
    });
    const out = await PDFDocument.load(pdf);
    expect(out.getPageCount()).toBe(3);
  });
});

describe("signature email", () => {
  it("uses the signed subject and shows a missing company as Not given", () => {
    expect(shareSignedSubject({ title: "Ladder check", site: "North Yard", name: "Pat Tester" })).toBe(
      "Signed: Ladder check, North Yard, Pat Tester",
    );
    expect(shareSignedSubject({ title: "Ladder check", site: null, name: "Pat Tester" })).toBe(
      "Signed: Ladder check, Not given, Pat Tester",
    );
    expect(shareSignedSubject({ title: "Ladder check", site: "North Yard", name: "Pat Tester" })).not.toContain("\u2014");
  });
});
