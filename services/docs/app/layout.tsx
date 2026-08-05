import type { Metadata } from "next";
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Goalkeeper Docs",
    template: "%s | Goalkeeper Docs"
  },
  description: "Documentation for Goalkeeper."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
