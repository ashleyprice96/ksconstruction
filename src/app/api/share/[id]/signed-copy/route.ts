import { currentUser } from "@/lib/auth";
import { shareById } from "@/lib/share";
import { buildShareSignedCopy } from "@/lib/share-pdf";

export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const item = await shareById(id);
  if (!item) return new Response("Not found", { status: 404 });
  const pdf = await buildShareSignedCopy(item);
  const filename = `${item.title.replace(/[^\w.\- ]/g, "_").slice(0, 60)}-signed-copy.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private",
    },
  });
}
