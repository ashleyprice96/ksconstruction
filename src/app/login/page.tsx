import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, login } from "@/lib/auth";
import { gangMustAcknowledge } from "@/lib/safety";
import { str } from "@/lib/forms";
import { productName } from "@/lib/features";

async function doLogin(f: FormData) {
  "use server";
  const result = await login(str(f, "login"), String(f.get("password") ?? ""));
  if (result === "change") redirect("/account/password");
  redirect(result === "ok" ? "/" : "/login?error=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await currentUser();
  if (user?.must_change_password) redirect("/account/password");
  if (user && await gangMustAcknowledge(user)) redirect("/safety");
  if (user) redirect("/");
  const sp = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/ks-logo.png" alt="" width={72} height={72} />
        <p className="eyebrow">K-S Construction Group</p>
        <h1>{productName() === "K-S Claims" ? "Claims" : "Health and safety"}</h1>
        <p className="lede">Sign in with your email or username.</p>
        {sp.error && <div className="alert error" role="alert">Those details were not recognised.</div>}
        <form action={doLogin} className="stack">
          <div><label htmlFor="login">Email or username</label><input id="login" name="login" type="text" autoComplete="username" required /></div>
          <div><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
          <button className="btn" type="submit">Sign in</button>
        </form>
        <p className="small" style={{ margin: "16px 0 0" }}><Link href="/login/forgot">Forgot password?</Link></p>
      </div>
    </div>
  );
}
