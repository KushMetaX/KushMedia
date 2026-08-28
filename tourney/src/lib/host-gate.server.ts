import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function firstLine(filePath: string): string {
  try {
    return String(readFileSync(filePath, "utf8") || "")
      .split(/\r?\n/)[0]
      .trim();
  } catch {
    return "";
  }
}

function passwordCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..", "..", "..");
  const fileEnv = String(process.env.TOURNEY_PASSWORD_FILE || "").trim();
  return [
    fileEnv,
    join(process.cwd(), ".tourney-password"),
    join(here, "..", "..", ".tourney-password"),
    join(repoRoot, "public", "server", "data", ".tourney-password"),
    join(repoRoot, "server", "data", ".tourney-password"),
  ].filter(Boolean);
}

/** Host secret from Node env or the same gitignored files KushMedia uses for DDL/Voyager. */
export function resolveHostPassword(): string {
  const fromEnv = String(process.env.TOURNEY_PASSWORD || "").trim();
  if (fromEnv) return fromEnv;
  for (const candidate of passwordCandidates()) {
    const value = firstLine(candidate);
    if (value) return value;
  }
  return "";
}

function passwordsMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function assertHostPassword(given: unknown): void {
  const expected = resolveHostPassword();
  if (!expected) {
    throw new Error(
      "Hosting is locked. Set TOURNEY_PASSWORD in Node, or put the password on line 1 of public/server/data/.tourney-password",
    );
  }
  if (!passwordsMatch(expected, String(given ?? "").trim())) {
    throw new Error("Host password rejected");
  }
}
