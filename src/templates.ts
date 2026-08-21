import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseTemplate, type RemarkableTemplate } from "rmcommunication-ts";

// "Blank" is the absence of a template, and drawing it would put an empty grid behind every page.
const IGNORED_TEMPLATES = new Set(["", "Blank"]);

/** Loads a mirrored template by name. Missing or unreadable templates render as no background. */
export function loadTemplate(mirrorRoot: string, name: string | null): RemarkableTemplate | null {
  if (name === null || IGNORED_TEMPLATES.has(name)) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  const path = join(mirrorRoot, "templates", `${name}.template`);
  if (!existsSync(path)) return null;
  try {
    return parseTemplate(readFileSync(path));
  } catch {
    return null;
  }
}
