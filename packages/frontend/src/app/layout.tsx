import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "COPR Index",
  description: "Discover Fedora COPR packages",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>
            <a href="/">COPR Index</a>
            <a href="/search">Browse</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
