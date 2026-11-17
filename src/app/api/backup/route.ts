import { currentUser } from "@/lib/auth";
import { safetyApiBlock } from "@/lib/safety";
import { audit } from "@/lib/audit";
import { buildPack } from "@/lib/backup";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "management" && user.role !== "admin")) return new Response("Not found", { status: 404 });
  const blocked = await safetyApiBlock(user);
  if (blocked) return blocked;
  const sp = new URL(req.url).searchParams;
  const client = sp.get("client") ?? ""; const from = sp.get("from") ?? ""; const to = sp.get("to") ?? ""; const part = Number(sp.get("part") ?? 1);
  if (!/^[0-9a-f-]{36}$/.test(client) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !(part >= 1)) return new Response("Bad request", { status: 400 });
  const pack = await buildPack(client, from, to, part);
  if (!pack) return new Response("Not found", { status: 404 });
  await audit(user.id, "backup_pack", client, "downloaded", { from, to, part });
  return new Response(new Uint8Array(pack.zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${pack.filename}"` } });
}
