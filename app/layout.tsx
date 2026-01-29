import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multi-Agent Proof Reviewer",
  description: "Multi-identity AI workflow for proof review."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        {children}
      </body>
    </html>
  );
}
