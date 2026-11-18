import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, ShieldCheck } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contract Guard",
  description: "Your API and service registry.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="header-inner">
            <Link href="/" className="brand" aria-label="Contract Guard home">
              <span className="brand-icon"><ShieldCheck size={20} strokeWidth={2.2} /></span>
              <span>contract<span className="brand-light">guard</span></span>
            </Link>
            <div className="header-divider" />
            <Link href="/" className="header-nav"><Boxes size={16} /> Registry</Link>
            <span className="header-caption">YOUR CONTRACT WORKSPACE</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
