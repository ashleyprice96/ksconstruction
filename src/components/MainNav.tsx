"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type NavLink = { href: string; label: string; restricted?: boolean };

const TAB_RANK = ["/", "/claims", "/payments", "/payments/mine", "/issues", "/notices", "/rates", "/setup", "/commercial"];

function activeHref(path: string, links: NavLink[]) {
  const matches = links.filter((l) => (l.href === "/" ? path === "/" : path === l.href || path.startsWith(`${l.href}/`)));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function DesktopNav({ links }: { links: NavLink[] }) {
  const path = usePathname() || "/";
  const current = activeHref(path, links);
  return (
    <nav className="mainnav" aria-label="Main">
      <ul>
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={current === l.href ? "page" : undefined} className={l.restricted ? "restricted" : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Icon({ href }: { href: string }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true as const };
  if (href === "/") return <svg {...common}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></svg>;
  if (href.startsWith("/payments")) return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>;
  if (href === "/issues") return <svg {...common}><path d="M12 8v5" /><circle cx="12" cy="16.5" r="0.8" fill="currentColor" /><path d="M10.3 4.8 3.8 16.2A2 2 0 0 0 5.5 19h13a2 2 0 0 0 1.7-2.8L13.7 4.8a2 2 0 0 0-3.4 0z" /></svg>;
  if (href === "/notices") return <svg {...common}><path d="M6 9a6 6 0 1 1 12 0c0 7 2 7 2 7H4s2 0 2-7" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>;
  if (href === "/rates") return <svg {...common}><path d="M4 18V6M4 18h16" /><path d="M8 14l4-5 3 3 5-6" /></svg>;
  if (href === "/setup") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>;
  if (href === "/commercial") return <svg {...common}><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
  if (href === "more") return <svg {...common}><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></svg>;
  return <svg {...common}><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v6h6" /></svg>;
}

export function MobileNav({ links }: { links: NavLink[] }) {
  const path = usePathname() || "/";
  const current = activeHref(path, links);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);

  const ranked = [...links].sort((a, b) => {
    const ai = TAB_RANK.indexOf(a.href);
    const bi = TAB_RANK.indexOf(b.href);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const split = ranked.length <= 5;
  const primary = split ? ranked : ranked.slice(0, 4);
  const more = split ? [] : ranked.slice(4);

  return (
    <>
      {open && more.length > 0 && (
        <div className="more-sheet" id="more-sheet">
          {more.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined} className={l.restricted ? "restricted" : undefined}>
              <Icon href={l.href} />
              {l.label}
            </Link>
          ))}
        </div>
      )}
      <nav className="tabbar" aria-label="Mobile">
        {primary.map((l) => (
          <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
            <Icon href={l.href} />
            {l.label}
          </Link>
        ))}
        {more.length > 0 && (
          <button type="button" aria-expanded={open} aria-controls="more-sheet" onClick={() => setOpen((v) => !v)}>
            <Icon href="more" />
            More
          </button>
        )}
      </nav>
    </>
  );
}
