/**
 * Post-build script: replaces __DEFAULT_API_URL__ in the built widget.js
 * with the value of the DEFAULT_API_URL environment variable.
 *
 * For local dev, set it in .env.local. For CI, set it as a GitHub secret.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DEFAULT_API_URL = process.env.DEFAULT_API_URL || "http://localhost:8000";
const widgetPath = join("dist", "widget.js");

try {
  let content = readFileSync(widgetPath, "utf-8");
  content = content.replace(/__DEFAULT_API_URL__/g, DEFAULT_API_URL);
  writeFileSync(widgetPath, content);
  console.log(`[inject-config] Set DEFAULT_API_URL = ${DEFAULT_API_URL}`);
} catch (err) {
  console.error("[inject-config] Failed:", err.message);
  process.exit(1);
}
