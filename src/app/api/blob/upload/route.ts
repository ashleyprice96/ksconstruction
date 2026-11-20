import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth";
import { blobTokenConfig, decideBlobToken, purposeOf } from "@/lib/blob-auth";

export const maxDuration = 60;

/**
 * Issues a private-blob upload token, then accepts Vercel's upload-completed callback.
 * The browser uploads the bytes itself. Linking the file to an alert, talk or RAMS
 * happens on the following small request, which still has the session cookie.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  if (body.type === "blob.generate-client-token") {
    const user = await currentUser();
    const decision = decideBlobToken(user?.role, purposeOf(body.payload.clientPayload), body.payload.pathname);
    if (!decision.ok) return Response.json({ error: decision.error }, { status: decision.status });
  }
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await currentUser();
        const decision = decideBlobToken(user?.role, purposeOf(clientPayload), pathname);
        if (!decision.ok) throw new Error(decision.error);
        return { ...blobTokenConfig(decision.purpose), tokenPayload: JSON.stringify({ userId: user!.id, purpose: decision.purpose }) };
      },
      onUploadCompleted: async () => {
        // Vercel calls this without the user's cookie. The publish route records the file.
      },
    });
    return Response.json(json);
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : "Upload was refused.";
    return Response.json({ error: message }, { status: 400 });
  }
}
