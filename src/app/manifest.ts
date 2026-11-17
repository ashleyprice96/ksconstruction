import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "K-S Claims",
    short_name: "K-S Claims",
    start_url: "/",
    display: "standalone",
    background_color: "#211F20",
    theme_color: "#211F20",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
