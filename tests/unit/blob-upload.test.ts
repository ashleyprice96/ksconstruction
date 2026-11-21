import { beforeEach, describe, expect, it, vi } from "vitest";

const currentUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ currentUser }));
vi.mock("@vercel/blob/client", () => ({
  handleUpload: async ({
    body,
    onBeforeGenerateToken,
  }: {
    body: { type: string; payload?: { pathname: string; clientPayload: string | null; multipart: boolean } };
    onBeforeGenerateToken: (pathname: string, clientPayload: string | null, multipart: boolean) => Promise<unknown>;
  }) => {
    if (body.type === "blob.generate-client-token" && body.payload) {
      await onBeforeGenerateToken(body.payload.pathname, body.payload.clientPayload, body.payload.multipart);
      return { type: "blob.generate-client-token", clientToken: "test-token" };
    }
    return { type: "blob.upload-completed", response: "ok" };
  },
}));

import { POST } from "../../src/app/api/blob/upload/route";
import { decideBlobToken } from "../../src/lib/blob-auth";
import { storageQuotaBytes } from "../../src/lib/object-store";

function tokenRequest(role: string | null, purpose: string, pathname: string) {
  currentUser.mockResolvedValue(role ? { id: "user-1", role } : null);
  return POST(new Request("http://local/api/blob/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, multipart: false, clientPayload: JSON.stringify({ purpose }) },
    }),
  }));
}

describe("blob upload token", () => {
  beforeEach(() => currentUser.mockReset());

  it("lets an administrator or a manager upload a health and safety file, and refuses everyone else", async () => {
    expect((await tokenRequest("admin", "hs", "blob/hs/talk.pdf")).status).toBe(200);
    expect((await tokenRequest("management", "rams", "blob/rams/site.pdf")).status).toBe(200);
    expect((await tokenRequest("gang", "hs", "blob/hs/talk.pdf")).status).toBe(403);
    expect((await tokenRequest("contracts_manager", "toolbox", "blob/hs/talk.pdf")).status).toBe(400);
    expect((await tokenRequest("contracts_manager", "rams", "blob/rams/site.pdf")).status).toBe(403);
    expect((await tokenRequest(null, "hs", "blob/hs/talk.pdf")).status).toBe(401);
    expect((await tokenRequest("management", "hs", "blob/rams/site.pdf")).status).toBe(400);
    expect((await tokenRequest("admin", "hs", "https://example.test/file.pdf")).status).toBe(400);
  });

  it("lets a gang lead upload a top sheet, and still refuses a health and safety file", async () => {
    expect((await tokenRequest("gang", "topsheet", "blob/topsheet/page.jpg")).status).toBe(200);
    expect((await tokenRequest("contracts_manager", "topsheet", "blob/topsheet/page.jpg")).status).toBe(403);
    expect(decideBlobToken("gang", "hs", "blob/hs/talk.pdf").ok).toBe(false);
    expect(decideBlobToken("management", "hs", "blob/hs/talk.pdf").ok).toBe(true);
  });

  it("answers the upload-completed callback without a session", async () => {
    currentUser.mockResolvedValue(null);
    const res = await POST(new Request("http://local/api/blob/upload", {
      method: "POST",
      body: JSON.stringify({ type: "blob.upload-completed", payload: { blob: { pathname: "blob/hs/talk.pdf" } } }),
    }));
    expect(res.status).toBe(200);
  });

  it("counts Blob storage against the 1 GB Hobby allowance unless a quota is set", () => {
    const previous = process.env.STORAGE_DRIVER;
    const quota = process.env.STORAGE_QUOTA_GB;
    process.env.STORAGE_DRIVER = "vercel-blob";
    delete process.env.STORAGE_QUOTA_GB;
    expect(storageQuotaBytes()).toBe(1024 * 1024 * 1024);
    process.env.STORAGE_QUOTA_GB = "2";
    expect(storageQuotaBytes()).toBe(2 * 1024 * 1024 * 1024);
    if (previous === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previous;
    if (quota === undefined) delete process.env.STORAGE_QUOTA_GB; else process.env.STORAGE_QUOTA_GB = quota;
  });
});
