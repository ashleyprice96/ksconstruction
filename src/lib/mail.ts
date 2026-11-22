import "server-only";

/** Tell the office someone signed a shared document. Does nothing when SMTP is not configured. */
export async function emailShareSigned(input: {
  to: string; name: string; company: string; kind: string; title: string; site: string | null;
  when: string; signature: Buffer; signedCopyUrl: string;
}): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  if (!host || !input.to) return;
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
    const lines = [
      `Name: ${input.name}`,
      `Company/gang: ${input.company || "—"}`,
      `Type: ${input.kind}`,
      `Site: ${input.site || "—"}`,
      `When: ${input.when}`,
      "",
      `Signed copy: ${input.signedCopyUrl}`,
    ];
    await transport.sendMail({
      from: process.env.SMTP_FROM?.trim() || user || input.to,
      to: input.to,
      subject: `${input.name} signed ${input.title}`,
      text: lines.join("\n"),
      html: `<p>${lines.slice(0, 5).join("<br>")}</p><p><img src="cid:sig" alt="Signature"></p><p><a href="${input.signedCopyUrl}">Signed copy</a></p>`,
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
