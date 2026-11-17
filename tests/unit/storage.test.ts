import { describe, expect, it } from "vitest";
import { MemoryStore, copyVerified, quotaWarning, storageQuotaBytes, storageDriver } from "../../src/lib/object-store";
import { hsPdfMaxBytes } from "../../src/lib/hs-pdf";
import { pdfStreamResponse } from "../../src/lib/pdf-stream";

describe("pluggable file storage", () => {
  it("keeps postgres as the default driver and a 50 MB PDF cap", () => {
    const previous = process.env.STORAGE_DRIVER;
    const cap = process.env.HS_PDF_MAX_MB;
    delete process.env.STORAGE_DRIVER;
    delete process.env.HS_PDF_MAX_MB;
    expect(storageDriver()).toBe("postgres");
    expect(hsPdfMaxBytes()).toBe(50 * 1024 * 1024);
    expect(storageQuotaBytes()).toBe(1024 * 1024 * 1024);
    process.env.HS_PDF_MAX_MB = "10";
    expect(hsPdfMaxBytes()).toBe(10 * 1024 * 1024);
    process.env.STORAGE_DRIVER = "s3";
    delete process.env.STORAGE_QUOTA_GB;
    expect(storageQuotaBytes()).toBeNull();
    process.env.STORAGE_QUOTA_GB = "10";
    expect(quotaWarning(8 * 1024 * 1024 * 1024, storageQuotaBytes())).toMatch(/80%/);
    expect(quotaWarning(1024, storageQuotaBytes())).toBeNull();
    if (previous === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previous;
    if (cap === undefined) delete process.env.HS_PDF_MAX_MB; else process.env.HS_PDF_MAX_MB = cap;
    delete process.env.STORAGE_QUOTA_GB;
  });

  it("copies to a mocked S3 client and clears Postgres only after the bytes match", async () => {
    const store = new MemoryStore();
    const body = Buffer.from("site rams pdf bytes");
    let cleared = false;
    await copyVerified(store, "files/rams/demo.pdf", body, "application/pdf", async () => { cleared = true; });
    expect(cleared).toBe(true);
    expect(await store.get("files/rams/demo.pdf", { start: 0, end: 3 })).toEqual(Buffer.from("site"));
    expect(await store.totalBytes()).toBe(body.length);

    const broken: MemoryStore = new MemoryStore();
    const original = broken.head.bind(broken);
    broken.head = async () => (await original("files/bad.pdf"))! + 1;
    let wiped = false;
    await expect(copyVerified(broken, "files/bad.pdf", body, "application/pdf", async () => { wiped = true; })).rejects.toThrow(/Postgres copy kept/);
    expect(wiped).toBe(false);
    expect(await broken.get("files/bad.pdf")).toEqual(body);
  });

  it("answers a range request with only the requested slice", async () => {
    const file = Buffer.from("abcdefghijklmnopqrstuvwxyz");
    const res = await pdfStreamResponse(new Request("http://local/file", { headers: { range: "bytes=2-5" } }), { length: file.length, name: "rams.pdf" }, async (start, end) => file.subarray(start, end + 1));
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-range")).toBe("bytes 2-5/26");
    expect(res.headers.get("cache-control")).toBe("private");
    expect(res.headers.get("content-length")).toBe("4");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("cdef");
  });
});
