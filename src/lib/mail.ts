import "server-only";

export function shareSignedSubject(input: { title: string; site: string | null; name: string }) {
  return `Signed: ${input.title}, ${input.site?.trim() || "Not given"}, ${input.name}`;
}

function mailEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Branded notice for one signature. Does nothing when SMTP is not configured. */
export async function emailShareSigned(input: {
  to: string; name: string; company: string; kind: string; title: string; site: string | null;
  when: string; signature: Buffer; signedCopyUrl: string;
}): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  if (!host || !input.to) return;
  const company = input.company.trim() || "Not given";
  const site = input.site?.trim() || "Not given";
  const subject = shareSignedSubject({ title: input.title, site: input.site, name: input.name });
  const text = [
    "K-S Construction Group",
    "Health and safety",
    "",
    subject,
    "",
    `Name: ${input.name}`,
    `Company/gang: ${company}`,
    `Type: ${input.kind}`,
    `Site: ${site}`,
    `Date and time (UK): ${input.when}`,
    "",
    `Download signed copy: ${input.signedCopyUrl}`,
  ].join("\n");
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1e2129;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#12172a;"><tr><td style="padding:20px 24px;">
    <div style="color:#ffffff;font-size:18px;font-weight:700;">K-S Construction Group</div>
    <div style="color:#E8732C;font-size:13px;margin-top:4px;">Health and safety</div>
  </td></tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px;">
    <h1 style="font-size:20px;margin:0 0 16px;">${mailEscape(subject)}</h1>
    <table role="presentation" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:560px;">
      <tr><td style="border-bottom:1px solid #e4e6eb;">Name</td><td style="border-bottom:1px solid #e4e6eb;"><strong>${mailEscape(input.name)}</strong></td></tr>
      <tr><td style="border-bottom:1px solid #e4e6eb;">Company/gang</td><td style="border-bottom:1px solid #e4e6eb;">${mailEscape(company)}</td></tr>
      <tr><td style="border-bottom:1px solid #e4e6eb;">Type</td><td style="border-bottom:1px solid #e4e6eb;">${mailEscape(input.kind)}</td></tr>
      <tr><td style="border-bottom:1px solid #e4e6eb;">Site</td><td style="border-bottom:1px solid #e4e6eb;">${mailEscape(site)}</td></tr>
      <tr><td style="border-bottom:1px solid #e4e6eb;">Date and time (UK)</td><td style="border-bottom:1px solid #e4e6eb;">${mailEscape(input.when)}</td></tr>
    </table>
    <p style="margin:20px 0 8px;">Signature</p>
    <p><img src="cid:sig" alt="Signature" style="background:#ffffff;border:1px solid #e4e6eb;max-width:280px;"></p>
    <p style="margin:24px 0;"><a href="${mailEscape(input.signedCopyUrl)}" style="background:#E8732C;color:#1a120c;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block;">Download signed copy</a></p>
  </td></tr></table>
  </body></html>`;
  try {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const address = process.env.SMTP_FROM?.trim() || user || input.to;
    const from = address.includes("<") ? address : `K-S H&S <${address}>`;
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
    });
    await transport.sendMail({
      from,
      to: input.to,
      subject,
      text,
      html,
      attachments: [{ filename: "signature.png", content: input.signature, cid: "sig" }],
    });
  } catch (e) {
    console.error("share sign email failed", e instanceof Error ? e.message : "unknown error");
  }
}

/** Tell the office about a reset request. Does nothing visible when SMTP is not configured. */
export async function emailResetRequest(identifier: string): Promise<void> {
  const to = process.env.RESET_REQUEST_EMAIL?.trim();
  const host = process.env.SMTP_HOST?.trim();
  if (!to || !host) {
    console.log("password reset recorded; RESET_REQUEST_EMAIL or SMTP_HOST is not set, so no email was sent");
    return;
  }
  try {
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass: process.env.SMTP_PASS ?? "" } : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM?.trim() || user || to,
      to,
      subject: "K-S Claims password reset request",
      text: `Someone asked to reset the K-S Claims login "${identifier}". Open Setup, Users, and set a temporary password. The person must choose a new password at their next sign-in.`,
    });
  } catch (e) {
    console.error("password reset email failed", e instanceof Error ? e.message : "unknown error");
  }
}
