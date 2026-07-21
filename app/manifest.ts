import type { MetadataRoute } from "next";

// PWA manifest only; no service worker is registered. If a SW is added later,
// implement "new version available" refresh (skipWaiting/claim + controllerchange).
// TODO: Replace placeholder icons with real Made By Mobbs logo.
// Paths: public/icons/icon-192.png (192×192), public/icons/icon-512.png (512×512).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Site Connect",
    short_name: "Site Connect",
    description: "Site Connect for Made By Mobbs job updates and QA checks",
    start_url: "/t/madebymobbs/jobs",
    display: "standalone",
    background_color: "#0F172A",
    theme_color: "#0F172A",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
