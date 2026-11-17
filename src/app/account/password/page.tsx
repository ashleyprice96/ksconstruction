import { redirect } from "next/navigation";
import { logout, requireUser } from "@/lib/auth";
import { AdminError } from "@/lib/admin";
import { setOwnPassword } from "@/lib/passwords";
import { safeMessage, str } from "@/lib/forms";

async function save(f: FormData) {
  "use server";
  const user = await requireUser(undefined, { allowPasswordChange: true });
  try {
    await setOwnPassword(user, String(f.get("password") ?? ""), String(f.get("confirm") ?? ""));
  } catch (e) {
    const message = safeMessage(e, [AdminError]);
    redirect(`/account/password?error=${encodeURIComponent(message)}`);
  }
  redirect("/");
}

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function PasswordPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(undefined, { allowPasswordChange: true });
  if (!user.must_change_password) redirect("/");
  const sp = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/ks-logo.png" alt="" width={72} height={72} />
        <p className="eyebrow">K-S Construction Group</p>
        <h1>Set a new password</h1>
        <p className="lede">Choose a password of at least 10 characters before you continue, {user.name.split(" ")[0]}.</p>
        {sp.error && <div className="alert error" role="alert">{sp.error}</div>}
        <form action={save} className="stack">
          <div><label htmlFor="password">New password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></div>
          <div><label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></div>
          <button className="btn" type="submit">Save password</button>
        </form>
        <form action={signOut} style={{ marginTop: 16 }}><button className="btn ghost" type="submit">Sign out</button></form>
      </div>
    </div>
  );
}
