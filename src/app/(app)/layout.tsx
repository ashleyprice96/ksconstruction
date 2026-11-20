import Link from "next/link";
import { currentUser, logout } from "@/lib/auth";
import { gangMustAcknowledge } from "@/lib/safety";
import { isNamedUser } from "@/lib/commercial";
import { claimsEnabled } from "@/lib/features";
import { redirect } from "next/navigation";
import { DesktopNav, MobileNav, type NavLink } from "@/components/MainNav";
import Breadcrumbs from "@/components/Breadcrumbs";
import HeaderSearch from "@/components/HeaderSearch";

const ROLE_LABEL = { gang: "Gang", contracts_manager: "Contracts manager", management: "Management", admin: "Administrator" } as const;

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "KS";
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/account/password");
  if (await gangMustAcknowledge(user)) redirect("/safety");
  const claims = claimsEnabled();
  const named = claims ? await isNamedUser(user) : false;
  const mgr = user.role === "management" || user.role === "admin";
  const links: NavLink[] = claims
    ? [
        { href: "/", label: "Dashboard" },
        { href: "/claims", label: "Claims" },
      ]
    : [{ href: "/", label: "Home" }];
  if (claims && user.role === "gang") links.push({ href: "/payments/mine", label: "Payments" });
  if (claims && mgr) links.push({ href: "/payments", label: "Payments" }, { href: "/rates", label: "Rates" });
  if (claims) links.push({ href: "/issues", label: "Issues" }, { href: "/notices", label: "Notices" });
  if (mgr) links.push({ href: "/setup", label: "Setup" });
  if (named) links.push({ href: "/commercial", label: "Margin", restricted: true });
  return (
    <>
      <a className="skip" href="#content">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <img src="/ks-logo.png" alt="" width={40} height={40} />
            <span><b>K-S</b><small>{claims ? "Construction Group Ltd" : "Health and safety"}</small></span>
          </Link>
          <DesktopNav links={links} />
          <div className="top-tools">
            <HeaderSearch />
            <div className="who">
              <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
              <div className="who-id">
                <span className="name">{user.name}</span>
                <span className="role">{ROLE_LABEL[user.role]}</span>
              </div>
              <form action={signOut}><button className="btn ghost small" type="submit">Sign out</button></form>
            </div>
          </div>
        </div>
      </header>
      <div className="crumb-bar"><div className="crumb-bar-inner"><Breadcrumbs root={claims ? "Dashboard" : "Home"} /></div></div>
      <main id="content">{children}</main>
      <MobileNav links={links} />
    </>
  );
}
