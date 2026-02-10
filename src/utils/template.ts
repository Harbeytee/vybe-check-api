import fs from "fs";
import path from "path";

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Load an HTML template by name (without .html) and replace {{key}} placeholders.
 * Values are escaped for HTML unless the key ends with "Raw".
 */
export function renderTemplate(
  name: string,
  vars: Record<string, string> = {}
): string {
  const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
  let html = fs.readFileSync(filePath, "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    const safe = key.endsWith("Raw") ? value : escapeHtml(value);
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), safe);
  }
  return html;
}
