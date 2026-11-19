import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/app-branding";

// PWA manifest only; no service worker is registered. If a SW is added later,
// implement "new version available" refresh (skipWaiting/claim + controllerchange).
// Lettermark icons are generated as PNGs for Android and browser installs.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: `${APP_NAME} for Made By Mobbs job planning and updates`,
    start_url: "/t/madebymobbs/jobs",
    display: "standalone",
    background_color: "#003923",
    theme_color: "#003923",
    icons: [
      {
        src: "/icons/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
