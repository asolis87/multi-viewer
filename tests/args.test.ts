import { describe, expect, it } from "vitest";
import { parseCliArgs, SKILL_USAGE } from "../src/cli/args.js";

describe("parseCliArgs", () => {
  it("no arguments", () => {
    expect(parseCliArgs([])).toEqual({ kind: "run", file: null, paste: false, open: true, port: 0, autoClose: false, detach: false });
  });

  it("a file", () => {
    expect(parseCliArgs(["notes.md"])).toMatchObject({ kind: "run", file: "notes.md" });
  });

  it("--paste and -p", () => {
    expect(parseCliArgs(["--paste"])).toMatchObject({ kind: "run", paste: true });
    expect(parseCliArgs(["-p"])).toMatchObject({ kind: "run", paste: true });
  });

  it("--no-open and --port", () => {
    expect(parseCliArgs(["--no-open", "--port", "4000", "a.json"])).toEqual({
      kind: "run",
      file: "a.json",
      paste: false,
      open: false,
      port: 4000,
      autoClose: false,
      detach: false,
    });
  });

  it("--auto-close (S11)", () => {
    expect(parseCliArgs(["--auto-close", "a.md"])).toMatchObject({ kind: "run", file: "a.md", autoClose: true });
    expect(parseCliArgs(["--paste", "--auto-close"])).toMatchObject({ kind: "run", paste: true, autoClose: true });
  });

  it("--detach with a file (S10)", () => {
    expect(parseCliArgs(["--detach", "a.md"])).toMatchObject({ kind: "run", file: "a.md", detach: true });
    expect(parseCliArgs(["--detach", "--port", "4000", "--no-open", "a.md"])).toEqual({
      kind: "run",
      file: "a.md",
      paste: false,
      open: false,
      port: 4000,
      autoClose: false,
      detach: true,
    });
  });

  it("--detach without a file or with --paste is a usage error (S10)", () => {
    const usage = { kind: "usage", message: "--detach needs a file" };
    expect(parseCliArgs(["--detach"])).toEqual(usage);
    expect(parseCliArgs(["--detach", "--paste"])).toEqual(usage);
    expect(parseCliArgs(["--detach", "--paste", "a.md"])).toEqual(usage);
  });

  describe("skill subcommand (S12)", () => {
    const skillUsage = { kind: "usage", message: SKILL_USAGE };
    const chooseAgent = { kind: "usage", message: "choose --agent pi|claude|codex" };

    it("skill print", () => {
      expect(parseCliArgs(["skill", "print"])).toEqual({ kind: "skill-print" });
    });

    it("skill install --agent <agent> [--force]", () => {
      for (const agent of ["pi", "claude", "codex"]) {
        expect(parseCliArgs(["skill", "install", "--agent", agent])).toEqual({ kind: "skill-install", agent, force: false });
      }
      expect(parseCliArgs(["skill", "install", "--force", "--agent=claude"])).toEqual({
        kind: "skill-install",
        agent: "claude",
        force: true,
      });
    });

    it("a missing, repeated or unknown --agent is a usage error", () => {
      expect(parseCliArgs(["skill", "install"])).toEqual(chooseAgent);
      expect(parseCliArgs(["skill", "install", "--force"])).toEqual(chooseAgent);
      expect(parseCliArgs(["skill", "install", "--agent"])).toEqual(chooseAgent);
      expect(parseCliArgs(["skill", "install", "--agent", "pi", "--agent", "pi"])).toEqual(chooseAgent);
      expect(parseCliArgs(["skill", "install", "--agent", "pi", "--agent", "codex"])).toEqual(chooseAgent);
      expect(parseCliArgs(["skill", "install", "--agent", "cursor"])).toEqual(chooseAgent);
    });

    it("a missing or unknown skill subcommand is a usage error", () => {
      expect(parseCliArgs(["skill"])).toEqual(skillUsage);
      expect(parseCliArgs(["skill", "bogus"])).toEqual(skillUsage);
      expect(parseCliArgs(["skill", "print", "extra"])).toEqual(skillUsage);
      expect(parseCliArgs(["skill", "print", "--force"])).toEqual(skillUsage);
      expect(parseCliArgs(["skill", "install", "--agent", "pi", "extra"])).toEqual(skillUsage);
      expect(parseCliArgs(["skill", "install", "--agent", "pi", "--bogus"])).toEqual(skillUsage);
    });

    it("only the first argument makes it a subcommand; ./skill is a file", () => {
      expect(parseCliArgs(["./skill"])).toMatchObject({ kind: "run", file: "./skill" });
      expect(parseCliArgs(["--no-open", "./skill"])).toMatchObject({ kind: "run", file: "./skill", open: false });
    });
  });

  it("--help, -h and --version, -v", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("rejects a file together with --paste", () => {
    expect(parseCliArgs(["--paste", "a.md"])).toEqual({
      kind: "error",
      message: "Use either a file or --paste, not both.",
    });
  });

  it("rejects more than one file (no tabs in v0.1)", () => {
    expect(parseCliArgs(["a.md", "b.md"])).toEqual({
      kind: "error",
      message: "Only one file at a time is supported.",
    });
  });

  it("rejects an invalid port", () => {
    expect(parseCliArgs(["--port", "abc"])).toEqual({
      kind: "error",
      message: "Invalid --port: abc",
    });
    expect(parseCliArgs(["--port", "70000"])).toEqual({
      kind: "error",
      message: "Invalid --port: 70000",
    });
  });

  it("rejects unknown options", () => {
    const result = parseCliArgs(["--nope"]);
    expect(result.kind).toBe("error");
  });
});
