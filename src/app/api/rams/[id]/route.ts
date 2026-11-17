import { currentUser } from "@/lib/auth";
import { ramsFile } from "@/lib/rams";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const file = await ramsFile(user, id);
  if (!file) return new Response("Not found", { status: 404 });
  const name = file.name.replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
