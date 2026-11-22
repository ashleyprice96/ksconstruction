import { headers } from "next/headers";
import { after } from "next/server";
import { currentUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { safeMessage, str } from "@/lib/forms";
import { emailShareSigned } from "@/lib/mail";
import { SHARE_KIND_LABEL, shareByToken, shareNotifyTo, signShare, userSigned, ShareError, type ShareKind } from "@/lib/share";
import PdfViewer from "@/components/PdfViewer";
import SignFormClient from "./sign-form";

const DOC_LABEL: Record<ShareKind, string> = {
  rams: "RAMS",
  toolbox: "toolbox talk",
  alert: "safety alert",
};

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
  if (f.get("confirm") !== "on") return { error: "Please tick the box to confirm you have read and understood the document." };
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
      const copy = `${originFrom(h)}/api/share/${saved.item.id}/signed-copy?signer=${saved.signatureId}`;
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

function Brand() {
  return (
    <header className="sign-brand">
      <img src="/ks-logo.png" alt="" width={48} height={48} />
      <span>
        <strong>K-S Construction Group</strong>
        <small>Health and safety</small>
      </span>
    </header>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const item = await shareByToken(token);
  const user = await currentUser();
  const done = item && user ? await userSigned(item.id, item.version, user.id) : false;
  const fileHref = `/api/sign/${token}`;
  return (
    <div className="sign-page">
      <Brand />
      {!item && (
        <section className="sign-card">
          <h1>Link not recognised</h1>
          <p>This signing link does not exist. Ask the office to send it again.</p>
        </section>
      )}
      {item && !item.active && (
        <section className="sign-card">
          <p className="eyebrow">{SHARE_KIND_LABEL[item.kind]}</p>
          <h1>{item.title}</h1>
          {item.site_name && <p className="sign-site">{item.site_name}</p>}
          <p>This link has been switched off. Please ask the office for a new link.</p>
        </section>
      )}
      {item && item.active && (
        <section className="sign-card">
          <p className="eyebrow">{SHARE_KIND_LABEL[item.kind]}</p>
          <h1>{item.title}</h1>
          <p className="sign-site">{item.site_name?.trim() || "Site not given"}</p>
          <h2 className="sign-step">1. Read the document</h2>
          {item.file_mime === "application/pdf" && (
            <>
              <a className="btn sign-view" href={fileHref} target="_blank" rel="noreferrer">View document</a>
              <PdfViewer id={item.id} src={fileHref} pages={item.pdf_pages} title={item.title} />
            </>
          )}
          {item.file_mime?.startsWith("image/") && (
            <>
              <a className="btn sign-view" href={fileHref} target="_blank" rel="noreferrer">View document</a>
              <img className="sign-photo" src={fileHref} alt={item.file_name ?? item.title} />
            </>
          )}
          {item.body && <p className="sign-body">{item.body}</p>}
          {!item.file_mime && !item.body && <p>No document was attached. You can still sign below.</p>}
          {done ? (
            <div className="sign-success" role="status">
              <p className="eyebrow">Recorded</p>
              <h2>You have already signed this.</h2>
              <p>Thank you. You can close this page.</p>
            </div>
          ) : (
            <SignFormClient token={token} name={user?.name ?? ""} docLabel={DOC_LABEL[item.kind]} action={confirm} />
          )}
        </section>
      )}
    </div>
  );
}
