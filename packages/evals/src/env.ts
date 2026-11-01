/**
 * Find ANTHROPIC_API_KEY without ever printing it: the environment first, then the
 * gitignored `.env` of the main checkout (worktrees share its git common dir).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function anthropicKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const file of envFiles()) {
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith("ANTHROPIC_API_KEY="));
    const value = line
      ?.slice("ANTHROPIC_API_KEY=".length)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return undefined;
}

function envFiles(): string[] {
  const candidates: string[] = [];
  try {
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    candidates.push(join(dirname(common), ".env"));
  } catch {
    // not in a git checkout; fall through to the working directory
  }
  candidates.push(join(process.cwd(), ".env"));
  return candidates.filter((f) => existsSync(f));
}
