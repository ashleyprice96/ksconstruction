import { currentUser } from "@/lib/auth";
import { publishSafetyAlert, SafetyError } from "@/lib/safety";

export const maxDuration = 120;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin") return Response.json({ ok: false, error: "Only an administrator can publish." }, { status: 403 });
  const f = await req.formData();
  const file = f.get("attachment");
  try {
    await publishSafetyAlert(user, {
      kind: String(f.get("kind") ?? "") === "toolbox" ? "toolbox" : "alert",
      title: String(f.get("title") ?? ""),
      body: String(f.get("body") ?? ""),
      active: f.get("active") === "on",
      dueOn: String(f.get("due_on") ?? ""),
      siteIds: f.getAll("site_id").map(String),
      file: file instanceof File ? file : null,
    });
  } catch (e) {
    const message = e instanceof SafetyError ? e.message : "Upload failed.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
  return Response.json({ ok: true, message: "Published. Gang leads must confirm it." });
}
