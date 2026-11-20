import type { MetadataRoute } from "next";
import { productName } from "@/lib/features";

export default function manifest(): MetadataRoute.Manifest {
  const name = productName();
  return {
    name,
    short_name: name,
    start_url: "/",
    display: "standalone",
    background_color: "#0B1020",
    theme_color: "#0B1020",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
