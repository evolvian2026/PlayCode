import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ServiceWorker } from "@/components/ServiceWorker";
import { EARLY_DISPLAY_SCRIPT } from "@/lib/display";
import "./globals.css";

export const metadata: Metadata = {
  title: "PlayCode",
  description: "Gamified coding practice and placement readiness for institutions",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#5b4bff",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The policy only lets scripts with this request's nonce run (see middleware.ts).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // The early script sets display attributes on <html> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: EARLY_DISPLAY_SCRIPT }} />
      </head>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
