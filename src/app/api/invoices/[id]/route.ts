import { currentUser } from "@/lib/auth";
import { safetyApiBlock } from "@/lib/safety";
import { invoicePdf } from "@/lib/payments";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const blocked = await safetyApiBlock(user);
  if (blocked) return blocked;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const inv = await invoicePdf(id).catch(() => null);
  if (!inv) return new Response("Not found", { status: 404 });
  const allowed = user.role === "management" || user.role === "admin" || (user.role === "gang" && user.gang_id === inv.gang_id);
  if (!allowed) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(inv.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${inv.number}.pdf"` } });
}
