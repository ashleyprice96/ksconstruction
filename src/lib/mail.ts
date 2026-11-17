import "server-only";

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
