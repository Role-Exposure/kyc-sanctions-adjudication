/* The pre-run commitment: COMMITMENT.md and COMMITMENT.json. Both are outside
   SHA256SUMS: they carry its digest, so no file of the kit carries theirs.
   This module reads both and checks them against the files of the kit; it
   never fills a value in. No network, no environment, no writing. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHA256SUMS_ENTRIES, SHA256SUMS_SHA256 } from "./integrity.js";
import { snapshotStatus } from "./list.js";
import { loadPackStatus } from "./packstatus.js";
import { loadThresholds } from "./thresholds.js";

const here = dirname(fileURLToPath(import.meta.url));
const PROSE = "COMMITMENT.md";
const CANONICAL = "COMMITMENT.json";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const at = (obj, path) => path.split(".").reduce((o, k) => (isObject(o) ? o[k] : undefined), obj);

function readBytes(file) {
  const path = join(here, file);
  return existsSync(path) ? readFileSync(path) : null;
}

const fileDigest = (file) => {
  const bytes = readBytes(file);
  return bytes ? sha256(bytes) : null;
};

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(join(here, file), "utf8"));
  } catch {
    return undefined;
  }
}

/* Two JSON values with the same keys and values, in any key order. */
function sameJson(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
  }
  return a === b;
}

const markers = (bytes) => (bytes ? bytes.toString("utf8").split("TBD").length - 1 : 0);

/* Both files as read now: their bytes, the parsed JSON (undefined when it does not parse) and its digest. */
function readCommitment() {
  const prose = readBytes(PROSE);
  const canonical = readBytes(CANONICAL);
  let values;
  if (canonical) {
    try {
      values = JSON.parse(canonical.toString("utf8"));
    } catch {
      values = undefined;
    }
  }
  return { prose, canonical, values, sha256: canonical ? sha256(canonical) : null };
}

/* One line for --check: absent, invalid, incomplete or present. */
export function commitmentLine() {
  const c = readCommitment();
  if (!c.prose && !c.canonical) return "absent";
  if (!c.prose || !isObject(c.values)) return "invalid";
  const tbd = markers(c.prose) + markers(c.canonical);
  if (tbd) return `incomplete tbd=${tbd}`;
  return `present ordinal=${c.values.ordinal} sha256=${c.sha256}`;
}

/* Every check of the freeze. Returns the findings, one line each, and, when
   there is none, the ordinal and the SHA-256 of COMMITMENT.json. */
export function freezeCheck() {
  const out = [];
  const find = (file, key, what) => out.push(`FREEZE ${file}: ${key}: ${what}`);

  const snapshot = snapshotStatus();
  if (snapshot !== "complete") find("snapshot.json", "description", snapshot);
  const t = loadThresholds();
  for (const k of t.invalid) find("thresholds.json", k, "invalid");
  for (const k of t.empty) find("thresholds.json", k, "empty");
  const ps = loadPackStatus();
  for (const k of ps.invalid) find("pack-status.json", k, "invalid");
  for (const k of ps.empty) find("pack-status.json", k, "empty");
  if (!ps.invalid.length && !ps.empty.length && !ps.bookMatch) find("pack-status.json", "accepted.bookSha256", "does not match data.js");

  const c = readCommitment();
  if (!c.prose) find(PROSE, "file", "missing");
  if (!c.canonical) find(CANONICAL, "file", "missing");
  else if (c.values === undefined) find(CANONICAL, "file", "not JSON");
  else if (!isObject(c.values)) find(CANONICAL, "file", "not a JSON object");
  for (const [file, bytes] of [[PROSE, c.prose], [CANONICAL, c.canonical]]) {
    const n = markers(bytes);
    if (n) find(file, "TBD", `${n} marker(s)`);
  }
  if (!isObject(c.values)) return { findings: out, ordinal: null, sha256: null };

  const v = c.values;
  const ord = v.ordinal;
  if (!Number.isInteger(ord) || ord < 1) find(CANONICAL, "ordinal", "not a whole number of at least 1");
  if (!c.prose || at(v, "prose.sha256") !== sha256(c.prose)) find(CANONICAL, "prose.sha256", `does not match ${PROSE}`);
  if (at(v, "kit.sha256sums") !== SHA256SUMS_SHA256) find(CANONICAL, "kit.sha256sums", "does not match SHA256SUMS");

  // kit.files: exactly the lines of SHA256SUMS, the same paths and digests.
  const files = at(v, "kit.files");
  if (!Array.isArray(files)) find(CANONICAL, "kit.files", "not an array");
  else {
    const byPath = new Map(files.filter(isObject).map((e) => [e.path, e.sha256]));
    if (files.length !== SHA256SUMS_ENTRIES.length) find(CANONICAL, "kit.files", `${files.length} entries, SHA256SUMS has ${SHA256SUMS_ENTRIES.length}`);
    for (const e of SHA256SUMS_ENTRIES) {
      if (!byPath.has(e.path)) find(CANONICAL, `kit.files ${e.path}`, "missing");
      else if (byPath.get(e.path) !== e.sha256) find(CANONICAL, `kit.files ${e.path}`, "does not match SHA256SUMS");
    }
    const listed = new Set(SHA256SUMS_ENTRIES.map((e) => e.path));
    for (const p of byPath.keys()) if (!listed.has(p)) find(CANONICAL, `kit.files ${p}`, "not in SHA256SUMS");
    const prose = c.prose ? c.prose.toString("utf8") : "";
    for (const e of SHA256SUMS_ENTRIES) if (!prose.includes(e.sha256)) find(PROSE, `kit.files ${e.path}`, "digest not in the prose");
  }

  for (const [key, file] of [
    ["book.sha256", "data.js"],
    ["list.descriptionSha256", "snapshot.json"],
    ["thresholds.sha256", "thresholds.json"],
    ["candidate.systemPromptSha256", "system-prompt.txt"],
  ]) {
    if (at(v, key) !== fileDigest(file)) find(CANONICAL, key, `does not match ${file}`);
  }
  if (!sameJson(at(v, "thresholds.values"), t.values)) find(CANONICAL, "thresholds.values", "does not match thresholds.json");
  if (!sameJson(at(v, "list.snapshot"), readJsonFile("snapshot.json"))) find(CANONICAL, "list.snapshot", "does not match snapshot.json");
  const status = ps.values;
  for (const [key, value] of [
    ["book.sample", at(status, "sample")],
    ["book.review", at(status, "review")],
    ["book.accepted.by", at(status, "accepted.by")],
    ["book.accepted.date", at(status, "accepted.date")],
    ["book.sha256", at(status, "accepted.bookSha256")],
  ]) {
    if (value === undefined || at(v, key) !== value) find(CANONICAL, key, "does not match pack-status.json");
  }
  if (at(v, "candidate.passes") !== at(t.values, "repeats.n")) find(CANONICAL, "candidate.passes", "does not match repeats.n of thresholds.json");

  return out.length ? { findings: out, ordinal: null, sha256: null } : { findings: out, ordinal: ord, sha256: c.sha256 };
}

/* The variables of a --model run that differ from the candidate and run blocks
   of the commitment: names only, never values. `cfg` is the parsed candidate
   configuration, `settings` the timeouts and retries in force. Each value is
   compared in the form the receipt records it; an unset one is null. */
export function configDifferences(cfg, settings) {
  const v = readCommitment().values;
  const pairs = [
    ["CANDIDATE_MODEL", cfg.name, "candidate.model"],
    ["CANDIDATE_API_STYLE", cfg.style, "candidate.apiStyle"],
    ["CANDIDATE_THINKING", cfg.thinking || null, "candidate.thinking"],
    ["CANDIDATE_MAX_TOKENS", cfg.maxTokens ?? null, "candidate.maxTokens"],
    ["CANDIDATE_PROVIDER", cfg.provider, "candidate.provider"],
    ["CANDIDATE_TEMPERATURE", cfg.temperature ?? null, "candidate.temperature"],
    ["LIST_TIMEOUT_MS", settings.listTimeoutMs, "run.listTimeoutMs"],
    ["MODEL_TIMEOUT_MS", settings.modelTimeoutMs, "run.modelTimeoutMs"],
    ["RETRY_MAX", settings.retryMax, "run.retryMax"],
  ];
  return pairs.filter(([, value, key]) => at(v, key) !== value).map(([name]) => name);
}
