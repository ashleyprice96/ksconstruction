import { currentUser } from "@/lib/auth";
import { hsPdfMaxBytes } from "@/lib/hs-pdf";
import { publishRams } from "@/lib/rams";
import { loadPrivateUpload } from "@/lib/storage-blob";
import { SafetyError } from "@/lib/safety";

export const maxDuration = 60;

async function ramsPrepared(pathname: string, sha: string, name: string) {
  if (!pathname.startsWith("blob/rams/")) throw new SafetyError("That file is not a RAMS upload.");
  try {
    const loaded = await loadPrivateUpload(pathname, sha, hsPdfMaxBytes());
    return { name: name || "rams.pdf", bytes: loaded.bytes, key: pathname };
  } catch (e) {
    if (e instanceof SafetyError) throw e;
    throw new SafetyError(e instanceof Error ? e.message : "Upload failed.");
  }
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin") return Response.json({ ok: false, error: "Only an administrator can publish." }, { status: 403 });
  const f = await req.formData();
  const file = f.get("pdf");
  const blobPath = String(f.get("blob_pathname") ?? "");
  try {
    const prepared = blobPath ? await ramsPrepared(blobPath, String(f.get("blob_sha") ?? ""), String(f.get("blob_name") ?? "")) : null;
    await publishRams(user, {
      siteId: String(f.get("site_id") ?? ""),
      title: String(f.get("title") ?? ""),
      revision: String(f.get("revision") ?? ""),
      active: f.get("active") === "on",
      file: prepared ? null : file instanceof File ? file : new File([], "empty.pdf", { type: "application/pdf" }),
      prepared,
    });
  } catch (e) {
    const message = e instanceof SafetyError ? e.message : "Upload failed.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
  return Response.json({ ok: true, message: "RAMS published. Gang leads must confirm this revision for that site." });
}
