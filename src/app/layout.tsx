import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { claimsEnabled, productName } from "@/lib/features";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: productName(),
  description: claimsEnabled() ? "K-S subcontractor claims, approvals and payments" : "K-S health and safety sign-off",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#0B1020", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body>
        <div className="atmosphere" aria-hidden="true">
          <span className="orb orb-a" />
          <span className="orb orb-b" />
          <span className="orb orb-c" />
        </div>
        {children}
      </body>
    </html>
  );
}
