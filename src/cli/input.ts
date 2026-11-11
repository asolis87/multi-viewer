import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { detectType } from "../shared/detect.js";
import { emptyDoc, type Doc, type DocSource } from "../shared/doc.js";

export { emptyDoc };
export type { Doc, DocSource };

/** A file is re-read on every request so live reload always shows the latest content. */
export async function readFileDoc(path: string): Promise<Doc> {
  const content = await readFile(path, "utf8");
  return fromContent(content, "file", basename(path));
}

export function fromContent(content: string, source: DocSource, name: string | null = null): Doc {
  return { name, type: detectType(content, name), content, source };
}

export async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
