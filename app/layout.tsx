import type { Metadata } from "next";
import { SupabaseAuthHashHandler } from "@/components/SupabaseAuthHashHandler";
import { APP_NAME } from "@/lib/app-branding";
import "./globals.css";

// Avoid static caching so clients get latest HTML/JS (reduces cached old draft-first flow).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${APP_NAME} - Made By Mobbs`,
  description: `${APP_NAME} for Made By Mobbs job planning and updates`,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: APP_NAME,
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
    <html lang="en-AU">
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
