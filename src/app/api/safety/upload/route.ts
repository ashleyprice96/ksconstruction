import { currentUser } from "@/lib/auth";
import { hsPdfMaxBytes } from "@/lib/hs-pdf";
import { loadPrivateUpload } from "@/lib/storage-blob";
import { publishSafetyAlert, SafetyError } from "@/lib/safety";

export const maxDuration = 60;

async function hsPrepared(pathname: string, sha: string, name: string, type: string) {
  if (!pathname.startsWith("blob/hs/")) throw new SafetyError("That file is not a health and safety upload.");
  try {
    const loaded = await loadPrivateUpload(pathname, sha, hsPdfMaxBytes());
    return { name: name || "document.pdf", type: type || loaded.type, bytes: loaded.bytes, key: pathname };
  } catch (e) {
    if (e instanceof SafetyError) throw e;
    throw new SafetyError(e instanceof Error ? e.message : "Upload failed.");
  }
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin") return Response.json({ ok: false, error: "Only an administrator can publish." }, { status: 403 });
  const f = await req.formData();
  const file = f.get("attachment");
  const blobPath = String(f.get("blob_pathname") ?? "");
  try {
    const prepared = blobPath ? await hsPrepared(blobPath, String(f.get("blob_sha") ?? ""), String(f.get("blob_name") ?? ""), String(f.get("blob_type") ?? "")) : null;
    await publishSafetyAlert(user, {
      kind: String(f.get("kind") ?? "") === "toolbox" ? "toolbox" : "alert",
      title: String(f.get("title") ?? ""),
      body: String(f.get("body") ?? ""),
      active: f.get("active") === "on",
      dueOn: String(f.get("due_on") ?? ""),
      siteIds: f.getAll("site_id").map(String),
      file: file instanceof File ? file : null,
      prepared,
    });
  } catch (e) {
    const message = e instanceof SafetyError ? e.message : "Upload failed.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
  return Response.json({ ok: true, message: "Published. Gang leads must confirm it." });
}
