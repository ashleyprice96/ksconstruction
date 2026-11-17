import { currentUser } from "@/lib/auth";
import { publishRams } from "@/lib/rams";
import { SafetyError } from "@/lib/safety";

export const maxDuration = 120;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin") return Response.json({ ok: false, error: "Only an administrator can publish." }, { status: 403 });
  const f = await req.formData();
  const file = f.get("pdf");
  try {
    await publishRams(user, {
      siteId: String(f.get("site_id") ?? ""),
      title: String(f.get("title") ?? ""),
      revision: String(f.get("revision") ?? ""),
      active: f.get("active") === "on",
      file: file instanceof File ? file : new File([], "empty.pdf", { type: "application/pdf" }),
    });
  } catch (e) {
    const message = e instanceof SafetyError ? e.message : "Upload failed.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
  return Response.json({ ok: true, message: "RAMS published. Gang leads must confirm this revision for that site." });
}
