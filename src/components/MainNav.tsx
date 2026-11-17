"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function MainNav({ links }: { links: { href: string; label: string; restricted?: boolean }[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [path]);

  function active(href: string) {
    const matches = links.filter((l) => (l.href === "/" ? path === "/" : path === l.href || path.startsWith(`${l.href}/`)));
    const best = matches.sort((a, b) => b.href.length - a.href.length)[0];
    return best?.href === href;
  }

  const current = links.find((l) => active(l.href));

  return (
    <nav className="mainnav" aria-label="Main">
      <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="mainnav-list" onClick={() => setOpen((v) => !v)}>
        <span className="nav-toggle-kicker">{open ? "Close" : "Menu"}</span>
        <span className="nav-current">{current?.label ?? "Sections"}</span>
      </button>
      <ul id="mainnav-list" className={open ? "open" : undefined}>
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={active(l.href) ? "page" : undefined} className={l.restricted ? "restricted" : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
