import { headers } from "next/headers";
import { after } from "next/server";
import { currentUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { safeMessage, str } from "@/lib/forms";
import { emailShareSigned } from "@/lib/mail";
import { SHARE_KIND_LABEL, shareByToken, shareNotifyTo, signShare, userSigned, ShareError } from "@/lib/share";
import PdfViewer from "@/components/PdfViewer";
import SignFormClient from "./sign-form";

function clientIp(h: Headers): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "unknown").slice(0, 64);
}

function originFrom(h: Headers): string {
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${proto}://${host}` : "";
}

async function confirm(f: FormData) {
  "use server";
  const h = await headers();
  const user = await currentUser();
  if (f.get("confirm") !== "on") return { error: "Tick to confirm you have read and understood." };
  try {
    const saved = await signShare({
      token: str(f, "token"),
      fullName: str(f, "full_name"),
      company: str(f, "company"),
      signatureDataUrl: str(f, "signature"),
      ip: clientIp(h),
      userAgent: h.get("user-agent") ?? "",
      userId: user?.id ?? null,
    });
    const to = shareNotifyTo();
    if (to) {
      const copy = `${originFrom(h)}/api/share/${saved.item.id}/signed-copy`;
      after(() => emailShareSigned({
        to,
        name: saved.name,
        company: saved.company,
        kind: SHARE_KIND_LABEL[saved.item.kind],
        title: saved.item.title,
        site: saved.item.site_name,
        when: fmtDateTime(new Date()),
        signature: saved.png,
        signedCopyUrl: copy,
      }));
    }
    return { ok: true };
  } catch (e) {
    return { error: safeMessage(e, [ShareError]) };
  }
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const item = await shareByToken(token);
  const user = await currentUser();
  const done = item && user ? await userSigned(item.id, item.version, user.id) : false;
  return (
    <div className="login-wrap">
      <div className="login-card wide">
        <img src="/ks-logo.png" alt="" width={72} height={72} />
        {!item && <h1>Link not found</h1>}
        {item && !item.active && (
          <>
            <p className="eyebrow">Signing link</p>
            <h1>{item.title}</h1>
            <p className="lede">This link is switched off.</p>
          </>
        )}
        {item && item.active && (
          <>
            <p className="eyebrow">{SHARE_KIND_LABEL[item.kind]}{item.site_name ? ` · ${item.site_name}` : ""}</p>
            <h1>{item.title}</h1>
            {item.body && <p style={{ whiteSpace: "pre-line" }}>{item.body}</p>}
            {item.file_mime === "application/pdf" && (
              <PdfViewer id={item.id} src={`/api/sign/${token}`} pages={item.pdf_pages} title={item.title} />
            )}
            {item.file_mime?.startsWith("image/") && (
              <img src={`/api/sign/${token}`} alt={item.file_name ?? item.title} style={{ width: "100%", height: "auto" }} />
            )}
            {done ? <p className="lede">You have signed this.</p> : <SignFormClient token={token} name={user?.name ?? ""} action={confirm} />}
          </>
        )}
      </div>
    </div>
  );
}
