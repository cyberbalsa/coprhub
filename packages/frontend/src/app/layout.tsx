import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "COPRHub",
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
            <a href="/">COPRHub</a>
            <a href="/search">Browse</a>
            <a href="https://api.coprhub.org/api" target="_blank" rel="noopener noreferrer">API</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
