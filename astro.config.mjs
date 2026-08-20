// @ts-check

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://kkt.dev",
  integrations: [mdx(), sitemap()],
  server: {
    allowedHosts: process.env.AMP_ORB ? true : undefined,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
