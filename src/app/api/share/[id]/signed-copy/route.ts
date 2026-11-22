import { currentUser } from "@/lib/auth";
import { shareById } from "@/lib/share";
import { buildShareSignedCopy } from "@/lib/share-pdf";

export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const signer = new URL(_req.url).searchParams.get("signer") ?? undefined;
  if (signer && !/^[0-9a-f-]{36}$/.test(signer)) return new Response("Not found", { status: 404 });
  const item = await shareById(id);
  if (!item) return new Response("Not found", { status: 404 });
  let pdf: Uint8Array;
  try { pdf = await buildShareSignedCopy(item, signer); }
  catch { return new Response("Not found", { status: 404 }); }
  const filename = `${item.title.replace(/[^\w.\- ]/g, "_").slice(0, 60)}-signed-copy.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private",
    },
  });
}
