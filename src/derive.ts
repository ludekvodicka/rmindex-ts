import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { readPageText, renderPageBytes, svgToPng } from "rmcommunication-ts";

import { readMirrorEntries, xochitlDirectory } from "./mirror-files.js";
import { loadTemplate } from "./templates.js";

export interface DeriveOptions {
  /** Raster width of the page images. */
  readonly imageWidth?: number;
  /** Page size for scenes that carry none of their own; defaults to the Paper Pro screen. */
  readonly fallbackPaperSize?: readonly [number, number];
  /** Re-renders every page, the recovery path when a cache is suspected to be stale. */
  readonly force?: boolean;
}

export interface DerivedPage {
  readonly documentId: string;
  readonly pageId: string;
  /** 1-based, the number the tablet prints. */
  readonly pageNumber: number;
  readonly imagePath: string;
  readonly text: string;
}

export interface DeriveResult {
  readonly rendered: readonly DerivedPage[];
  /** Pages whose cached image was already current. */
  readonly reused: number;
  /** One line per page that could not be rendered; a bad page never fails the run. */
  readonly failed: readonly string[];
}

const DEFAULT_IMAGE_WIDTH = 1400;
const PAPER_PRO_PAGE: readonly [number, number] = [1620, 2160];

/**
 * Renders every mirrored page that changed since the last run into `<mirrorRoot>/derived/pages/` and
 * extracts its typed text next to it. Reads the mirror only; nothing here touches a device.
 */
export async function derivePages(mirrorRoot: string, options: DeriveOptions = {}): Promise<DeriveResult> {
  const width = options.imageWidth ?? DEFAULT_IMAGE_WIDTH;
  const documents = xochitlDirectory(mirrorRoot);
  const rendered: DerivedPage[] = [];
  const failed: string[] = [];
  let reused = 0;

  for (const { entry } of readMirrorEntries(mirrorRoot).entries) {
    if (entry.deleted || entry.pages.length === 0) continue;
    const pageDirectory = join(mirrorRoot, "derived", "pages", entry.id);
    for (const page of entry.pages) {
      const source = join(documents, entry.id, `${page.id}.rm`);
      if (!existsSync(source)) continue;
      const imagePath = join(pageDirectory, `${page.number}.png`);
      const textPath = join(pageDirectory, `${page.number}.txt`);
      if (options.force !== true && isCurrent(imagePath, source)) {
        reused++;
        rendered.push({
          documentId: entry.id,
          pageId: page.id,
          pageNumber: page.number,
          imagePath,
          text: readSidecar(textPath),
        });
        continue;
      }
      try {
        const bytes = readFileSync(source);
        const template = loadTemplate(mirrorRoot, page.template);
        const svg = renderPageBytes(bytes, {
          fallbackPaperSize: options.fallbackPaperSize ?? PAPER_PRO_PAGE,
          ...(template === null ? {} : { template }),
        });
        const png = await svgToPng(svg.svg, { width });
        const text = readPageText(bytes);
        mkdirSync(pageDirectory, { recursive: true });
        writeAtomic(imagePath, Buffer.from(png.bytes));
        writeAtomic(textPath, Buffer.from(text, "utf8"));
        rendered.push({ documentId: entry.id, pageId: page.id, pageNumber: page.number, imagePath, text });
      } catch (error) {
        failed.push(`${entry.id}/${page.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { rendered, reused, failed };
}

export function pageImagePath(mirrorRoot: string, documentId: string, pageNumber: number): string {
  return join(mirrorRoot, "derived", "pages", documentId, `${pageNumber}.png`);
}

// The mirror rewrites a page file whenever the tablet changed it, so its modification time is all the
// invalidation this cache needs.
function isCurrent(imagePath: string, source: string): boolean {
  try {
    return statSync(imagePath).mtimeMs >= statSync(source).mtimeMs;
  } catch {
    return false;
  }
}

// The sidecar exists so a rebuilt index gets its page text back without re-rendering anything.
function readSidecar(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeAtomic(path: string, data: Buffer): void {
  const temporary = `${path}.part-${randomBytes(8).toString("hex")}`;
  writeFileSync(temporary, data);
  renameSync(temporary, path);
}
