import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename } from "node:path";
import type { DocumentTabs } from "../shared/tabs.js";
import { fromContent, type Doc } from "./input.js";

export async function watchFile(path: string, onChange: () => void) {
  const { watch } = await import("chokidar");
  const watcher = watch(path, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 } });
  watcher.on("all", onChange);
  try {
    await new Promise<void>((ready, fail) => {
      watcher.once("ready", ready);
      watcher.once("error", fail);
    });
  } catch (error) {
    await watcher.close();
    throw error;
  }
  return watcher;
}

/** Keep full filesystem paths out of tabbed HTTP error responses. */
async function readTabDoc(path: string, name: string): Promise<Doc> {
  try {
    return fromContent(await readFile(path, "utf8"), "file", name);
  } catch {
    throw new Error(`${name} could not be read.`);
  }
}

export function fileTabs(onChange: () => void) {
  type Entry = { id: string; path: string; name: string; watcher: Awaited<ReturnType<typeof watchFile>> };
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Entry>>();
  let active = "";
  let revision = 0;
  let closed = false;

  async function select(path: string): Promise<boolean> {
    if (closed) return false;
    const canonicalPath = await realpath(path);
    if (closed) return false;
    let work = pending.get(canonicalPath);
    if (!work) {
      // Watch and read the target, but keep the original basename as the label and type hint.
      work = watchFile(canonicalPath, onChange).then((watcher) => {
        const entry = { id: randomUUID(), path: canonicalPath, name: basename(path), watcher };
        entries.set(entry.id, entry);
        return entry;
      });
      pending.set(canonicalPath, work);
      void work.catch(() => pending.delete(canonicalPath));
    }
    const entry = await work;
    if (closed) return false;
    active = entry.id;
    revision++;
    onChange();
    return true;
  }

  return {
    select,
    describe(): DocumentTabs {
      return { active, revision, tabs: Array.from(entries.values(), ({ id, name }) => ({ id, name })) };
    },
    get(id: string): (() => Promise<Doc>) | undefined {
      const entry = entries.get(id);
      return entry ? () => readTabDoc(entry.path, entry.name) : undefined;
    },
    async close(): Promise<void> {
      closed = true;
      await Promise.allSettled(pending.values());
      await Promise.all(Array.from(entries.values(), ({ watcher }) => watcher.close()));
    },
  };
}
