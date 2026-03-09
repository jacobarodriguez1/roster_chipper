import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CACC roster_chipper",
  description: "California Cadet Corps drill competition planning engine",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="cacc">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <div className="app-shell">
          <header className="app-header">
            <h1>CACC roster_chipper</h1>
            <nav className="app-nav">
              <Link href="/">Upload</Link>
              <Link href="/issues">Issues</Link>
              <Link href="/teams">Teams</Link>
              <Link href="/staging">Staging</Link>
              <Link href="/stats">Stats</Link>
              <Link href="/scheduler-config">Scheduler Config</Link>
              <Link href="/matrix">Matrix</Link>
            </nav>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
