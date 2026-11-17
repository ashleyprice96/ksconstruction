import { currentUser } from "@/lib/auth";
import { alertSignedRecord } from "@/lib/hs-record";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const pdf = await alertSignedRecord(id);
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"signed-record.pdf\"" },
  });
}
