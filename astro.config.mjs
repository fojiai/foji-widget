import { defineConfig } from "astro/config";

export default defineConfig({
  // The widget is built as a standalone JS bundle, not a full site.
  // output: "static" lets us serve a test page in dev.
  output: "static",
  build: {
    // Output a single file that customers paste into their sites.
    assets: "widget-assets",
  },
});
