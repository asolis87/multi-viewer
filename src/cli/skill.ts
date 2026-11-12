import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENTS = ["pi", "claude", "codex"] as const;
export type Agent = (typeof AGENTS)[number];

interface Writer {
  write(text: string): void;
}

/** The bundled skill, found relative to `dist/cli/` in the repository and in the installed package. */
const SKILL_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../skills/mview/SKILL.md");

export function readSkill(): Promise<Buffer> {
  return readFile(SKILL_FILE);
}

/** S12: pi and codex share `~/.agents/skills` (Pi reads it too); claude uses `~/.claude/skills`. */
export function skillTarget(agent: Agent, home: string = homedir()): string {
  const root = agent === "claude" ? join(home, ".claude") : join(home, ".agents");
  return join(root, "skills", "mview", "SKILL.md");
}

/** Installs the skill for one agent; never replaces different content without `force`. Returns the exit code. */
export async function installSkill(agent: Agent, force: boolean, stdout: Writer, stderr: Writer): Promise<number> {
  const path = skillTarget(agent);
  try {
    const skill = await readSkill();
    let existing: Buffer | null = null;
    try {
      existing = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing?.equals(skill)) {
      stdout.write(`mview: skill already up to date: ${path}\n`);
      return 0;
    }
    if (existing && !force) {
      stderr.write(`mview: ${path} already exists with different content; use --force to replace it\n`);
      return 1;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, skill);
    stdout.write(`mview: ${existing ? "replaced" : "installed"} skill for ${agent}: ${path}\n`);
    return 0;
  } catch (error) {
    stderr.write(`mview: ${(error as Error).message}\n`);
    return 1;
  }
}
