import { currentUser } from "@/lib/auth";
import { hsPdfMaxBytes } from "@/lib/hs-pdf";
import { loadPrivateUpload } from "@/lib/storage-blob";
import { createShareItem, ShareError } from "@/lib/share";

export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) {
    return Response.json({ ok: false, error: "Only the office can send a document for signing." }, { status: 403 });
  }
  const f = await req.formData();
  const blobPath = String(f.get("blob_pathname") ?? "");
  const upload = f.get("file");
  try {
    let file: { name: string; type: string; bytes: Buffer; key: string | null } | null = null;
    if (blobPath) {
      if (!blobPath.startsWith("blob/share/")) throw new ShareError("That file is not a signing upload.");
      let loaded: { bytes: Buffer; type: string };
      try { loaded = await loadPrivateUpload(blobPath, String(f.get("blob_sha") ?? ""), hsPdfMaxBytes()); }
      catch (e) { throw new ShareError(e instanceof Error ? e.message : "Upload failed."); }
      file = { name: String(f.get("blob_name") ?? "document"), type: String(f.get("blob_type") ?? loaded.type), bytes: loaded.bytes, key: blobPath };
    } else if (upload instanceof File && upload.size > 0) {
      file = { name: upload.name, type: upload.type, bytes: Buffer.from(await upload.arrayBuffer()), key: null };
    }
    const created = await createShareItem(user, {
      kind: String(f.get("kind") ?? ""),
      title: String(f.get("title") ?? ""),
      body: String(f.get("body") ?? ""),
      siteName: String(f.get("site_name") ?? ""),
      file,
    });
    const origin = new URL(req.url).origin;
    return Response.json({ ok: true, ...created, url: `${origin}/sign/${created.token}` });
  } catch (e) {
    const message = e instanceof ShareError ? e.message : "Could not create the signing link.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
