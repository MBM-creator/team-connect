import type { Metadata } from "next";
import { SupabaseAuthHashHandler } from "@/components/SupabaseAuthHashHandler";
import "./globals.css";

// Avoid static caching so clients get latest HTML/JS (reduces cached old draft-first flow).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site Connect - Made By Mobbs",
  description: "Site Connect for Made By Mobbs job updates and QA checks",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Site Connect",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport = { themeColor: "#0F172A" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
      </head>
      <body className="antialiased">
        <SupabaseAuthHashHandler />
        {children}
      </body>
    </html>
  );
}
