import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "K-S Claims",
  description: "K-S subcontractor claims, approvals and payments",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#211F20", width: "device-width", initialScale: 1 };

const themeBoot = `try{var t=localStorage.getItem("ks-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${barlow.variable} ${barlowCondensed.variable}`} suppressHydrationWarning>
      <body>
        <Script id="ks-theme" strategy="beforeInteractive">{themeBoot}</Script>
        {children}
      </body>
    </html>
  );
}
