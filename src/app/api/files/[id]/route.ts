import { currentUser } from "@/lib/auth";
import { openAttachment } from "@/lib/attachments";
import { safetyApiBlock } from "@/lib/safety";

// Serves an uploaded file only to someone allowed to see its claim or issue.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const blocked = await safetyApiBlock(user);
  if (blocked) return blocked;
  const { id } = await params;
  const file = await openAttachment(user, id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename="${file.name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
