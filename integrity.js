/* Digest check. run.mjs imports this module first and loads every other module
   of the kit only after it, so it runs before any other file of the kit is
   parsed, before .env is read and before any network call. Every file named
   in SHA256SUMS must exist and match its digest, and the files the kit cannot
   run without must be named there. Any failure exits 3. Extra files in the
   folder (.env, runs/) are not checked. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const REQUIRED = [
  "run.mjs",
  "data.js",
  "rubric.js",
  "list.js",
  "candidate.js",
  "baseline.js",
  "snapshot.json",
  "package.json",
  "integrity.js",
  "runlog.js",
  "system-prompt.txt",
  "assemble.js",
  "thresholds.json",
  "thresholds.js",
  "pack-status.json",
  "packstatus.js",
  "scoring.js",
  "rescore.js",
  "commitment.js",
];

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(3);
}

function digest(file) {
  try {
    return createHash("sha256").update(readFileSync(join(here, file))).digest("hex");
  } catch {
    return null;
  }
}

let bytes = Buffer.alloc(0);
try {
  bytes = readFileSync(join(here, "SHA256SUMS"));
} catch {
  fail(["SHA256SUMS: cannot be read"]);
}
const text = bytes.toString("utf8");

/* The SHA-256 of the SHA256SUMS bytes checked here; receipts name it as kit.sha256sums. */
export const SHA256SUMS_SHA256 = createHash("sha256").update(bytes).digest("hex");

/* The lines of SHA256SUMS checked here, in file order: { path, sha256 }. */
export const SHA256SUMS_ENTRIES = [];

const listed = new Set();
const problems = [];
text.split("\n").forEach((line, i) => {
  if (line === "") return;
  const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
  if (!m) {
    problems.push(`SHA256SUMS: line ${i + 1}: malformed`);
    return;
  }
  const [, expected, file] = m;
  SHA256SUMS_ENTRIES.push({ path: file, sha256: expected });
  listed.add(file);
  if (digest(file) !== expected) problems.push(`SHA256SUMS: ${file}: FAILED`);
});
for (const file of REQUIRED) {
  if (!listed.has(file)) problems.push(`SHA256SUMS: ${file}: not listed`);
}
if (problems.length) fail(problems);
