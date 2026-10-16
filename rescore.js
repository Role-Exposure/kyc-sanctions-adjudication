/* --rescore <receipt> [--manifest <result manifest>]: recomputes the grading
   of a published receipt from its decision rows, with the function the runner
   uses. No network, keys, environment, export, runs/ or log; nothing is
   written, and neither path is ever printed. The receipt must be listed in
   the result manifest when one is given, and must belong to the files of
   this kit; then its passes are checked for shape, graded again and compared.
   The signature of the manifest is checked outside the kit. Returns the exit
   code: 0 match, 2 refused, 6 mismatch. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SHA256SUMS_SHA256 } from "./integrity.js";
import { META, PARTIES } from "./data.js";
import { visibleParty } from "./candidate.js";
import { summarize } from "./rubric.js";
import { loadThresholds, thresholdsProblem } from "./thresholds.js";
import { loadPackStatus } from "./packstatus.js";
import { DECISION_KEYS, aggLine, decisionsLine, passLines, runnerStopped, scoreRun } from "./scoring.js";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;
const RECEIPT_FILE = /^runs\/[A-Za-z0-9-]+\.json$/;
const ANSWERS = new Set(["hit", "hold", "clear", "invalid"]);
const FRACTIONS = new Set(["hitPrecision", "manualShare", "agreement", "lower", "upper"]);
const MAX_LINES = 20;
const ABSENT = Symbol("absent");

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* The bytes of a JSON file and its value, or null. */
function readJson(path) {
  try {
    const bytes = readFileSync(path);
    return { sha256: sha256(bytes), value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return null;
  }
}

/* The minimum of the result manifest the kit reads; any other key is not read. */
function manifestReceipts(m) {
  if (!isObject(m) || m.format !== "result-manifest" || m.formatVersion !== 1) return null;
  if (!Array.isArray(m.receipts) || !m.receipts.length) return null;
  const seen = new Set();
  for (const e of m.receipts) {
    if (!isObject(e) || typeof e.file !== "string" || !RECEIPT_FILE.test(e.file)) return null;
    if (typeof e.sha256 !== "string" || !HEX64.test(e.sha256) || seen.has(e.sha256)) return null;
    seen.add(e.sha256);
  }
  return m.receipts;
}

/* The mode of the run: the first part of its runId, "baseline" or "model". */
function modeOf(r) {
  const m = typeof r.runId === "string" ? /^(baseline|model)-/.exec(r.runId) : null;
  return m ? m[1] : null;
}

/* A value as printed: numbers, codes and digests; other text is not printed. */
function shown(v) {
  if (v === ABSENT || v === undefined) return "absent";
  if (v === null || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return /^[A-Za-z0-9._:+-]{1,64}$/.test(v) ? v : "text";
  return Array.isArray(v) ? "array" : "object";
}

/* The first leaf where two JSON values differ, in the order of the published value, or null. */
function firstDiff(a, b, path) {
  if (a === undefined || b === undefined) return a === b ? null : { path, a, b };
  if (isObject(a) && isObject(b)) {
    for (const k of Object.keys(a)) {
      const d = has(b, k) ? firstDiff(a[k], b[k], `${path}.${k}`) : { path: `${path}.${k}`, a: a[k], b: ABSENT };
      if (d) return d;
    }
    for (const k of Object.keys(b)) if (!has(a, k)) return { path: `${path}.${k}`, a: ABSENT, b: b[k] };
    return null;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const at = `${path}[${i}]`;
      const d = i < a.length && i < b.length ? firstDiff(a[i], b[i], at) : { path: at, a: i < a.length ? a[i] : ABSENT, b: i < b.length ? b[i] : ABSENT };
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : { path, a, b };
}

/* inputSha256 of a literal row, as assemble.js computes it: the SHA-256 of the JSON of its visible row. */
const literalDigest = (p) => createHash("sha256").update(JSON.stringify(visibleParty(p)), "utf8").digest("hex");

/* The receipt against the files of this kit: keys that differ. */
function bindingProblems(r, t) {
  const out = [];
  if (!isObject(r.kit) || r.kit.sha256sums !== SHA256SUMS_SHA256) out.push("kit.sha256sums");
  if (r.thresholdsSha256 !== t.sha256) out.push("thresholdsSha256");
  if (firstDiff(r.thresholds, t.values, "thresholds")) out.push("thresholds");
  if (!isObject(r.packStatus) || r.packStatus.statusSha256 !== loadPackStatus().sha256) out.push("packStatus.statusSha256");
  if (isObject(r.input)) {
    if (r.input.recipeVersion !== META.recipeVersion) out.push("input.recipeVersion");
    const rows = r.input.parties;
    const same =
      Array.isArray(rows) &&
      rows.length === PARTIES.length &&
      PARTIES.every((p, i) => {
        const q = rows[i];
        if (!isObject(q) || q.id !== p.id) return false;
        if (!p.entity) return q.source === "literal" && !has(q, "entity") && !has(q, "recipe");
        return q.source === "entity" && q.entity === p.entity && !firstDiff(q.recipe, JSON.parse(JSON.stringify(p.recipe)), "");
      });
    if (!same) out.push("input.parties");
    else {
      PARTIES.forEach((p, i) => {
        if (!p.entity && rows[i].inputSha256 !== literalDigest(p)) out.push(`input.parties[${i}].inputSha256`);
      });
    }
  }
  return out;
}

/* What is wrong with one decision row, as a key suffix, or null. */
function rowProblem(d, keys) {
  if (!isObject(d)) return "";
  for (const k of Object.keys(d)) if (!keys.has(k)) return `.${k}`;
  if (!ANSWERS.has(d.decision)) return ".decision";
  if (!Number.isInteger(d.matchCalls) || d.matchCalls < 0) return ".matchCalls";
  if (has(d, "error")) {
    if (!isObject(d.error) || typeof d.error.class !== "string") return ".error";
    if (has(d.error, "status") && d.error.status !== null && typeof d.error.status !== "number") return ".error.status";
  }
  if (has(d, "topMatch")) {
    if (!isObject(d.topMatch)) return ".topMatch";
    if (has(d.topMatch, "id") && d.topMatch.id !== null && typeof d.topMatch.id !== "string") return ".topMatch.id";
  }
  return null;
}

/* The form of the run and its passes: keys that are wrong. */
function shapeProblems(r, passes, mode, declared) {
  const out = [];
  const ids = PARTIES.map((p) => p.id);
  const keys = new Set(DECISION_KEYS[mode]);
  if (r.status === "not-completed") {
    if (r.rerun !== "eligible" && r.rerun !== "not-eligible") out.push("rerun");
    if (!isObject(r.reason) || typeof r.reason.class !== "string") out.push("reason");
  } else if (r.status !== "completed") out.push("status");
  else if (has(r, "rerun")) out.push("rerun");
  passes.forEach((p, i) => {
    const at = `passes[${i}]`;
    if (!isObject(p)) {
      out.push(at);
      return;
    }
    if (p.index !== i + 1) out.push(`${at}.index`);
    if (p.status === "not-completed") {
      if (!isObject(p.reason) || typeof p.reason.class !== "string") out.push(`${at}.reason`);
      if (i < passes.length - 1) out.push(`passes[${i + 1}]`);
    } else if (p.status !== "completed") out.push(`${at}.status`);
    const stopped = runnerStopped(p);
    if (stopped && has(p, "grade")) out.push(`${at}.grade`);
    if (!has(p, "decisions")) {
      if (!stopped) out.push(`${at}.decisions`);
      if (has(p, "decisionsSha256")) out.push(`${at}.decisionsSha256`);
      return;
    }
    const rows = Array.isArray(p.decisions) ? p.decisions : null;
    // One row per book row, in book order; a pass the runner stopped has the rows before the stop.
    const inOrder = rows && rows.every((d, j) => isObject(d) && d.id === ids[j]);
    if (!inOrder || (stopped ? rows.length > ids.length : rows.length !== ids.length)) out.push(`${at}.decisions`);
    if (rows) {
      rows.forEach((d, j) => {
        const bad = rowProblem(d, keys);
        if (bad !== null) out.push(`${at}.decisions[${j}]${bad}`);
      });
    }
    if (typeof p.decisionsSha256 !== "string" || !HEX64.test(p.decisionsSha256)) out.push(`${at}.decisionsSha256`);
  });
  // A completed run has every declared pass; a run not completed has no more.
  if (r.status === "completed" ? passes.length !== declared : passes.length > declared) out.push("passes");
  return out;
}

/* Recomputed against published: the first differing leaf of each compared key. */
function valueDiffs(r, passes, scored, mode) {
  const out = [];
  scored.passes.forEach((rec, i) => {
    for (const k of ["status", "reason", "numbers", "rubric", "grade", "decisionsSha256"]) {
      const d = firstDiff(passes[i][k], rec[k], `passes[${i}].${k}`);
      if (d) out.push(d);
    }
  });
  const top = { status: scored.summary.status, reason: scored.reason || undefined, rubric: scored.summary.rubric, rerun: scored.summary.rerun };
  for (const k of ["status", "reason", "rubric", "rerun"]) {
    const d = firstDiff(r[k], top[k], k);
    if (d) out.push(d);
  }
  if (mode === "model") {
    const d = firstDiff(isObject(r.repeats) ? r.repeats.completed : undefined, scored.completed, "repeats.completed");
    if (d) out.push(d);
  }
  return out;
}

const major = (v) => {
  const m = /^v(\d+)\./.exec(String(v));
  return m ? m[1] : null;
};

/* At most MAX_LINES mismatch lines, then the count of the rest. */
function printMismatches(lines) {
  for (const line of lines.slice(0, MAX_LINES)) console.log(line);
  if (lines.length > MAX_LINES) console.log(`… more=${lines.length - MAX_LINES}`);
}

function refused(reason) {
  console.log(`RESCORE refused reason=${reason}`);
  return 2;
}

function mismatch(lines) {
  printMismatches(lines);
  console.log("RESCORE mismatch");
  return 6;
}

export function rescore(receiptPath, manifestPath) {
  const t = loadThresholds();
  const problem = thresholdsProblem(t);
  if (problem) {
    console.error(problem);
    return 2;
  }
  const receipt = readJson(receiptPath);
  if (!receipt) return refused("json");
  const r = receipt.value;
  if (!isObject(r) || r.schemaVersion !== 1) return refused("schema");
  if (!Array.isArray(r.passes) && r.status !== "not-completed") return refused("shape");
  const mode = modeOf(r);
  if (!mode) return refused("shape");
  let manifest = null;
  if (manifestPath != null) {
    const m = readJson(manifestPath);
    const receipts = m && manifestReceipts(m.value);
    if (!receipts) return refused("manifest");
    manifest = { sha256: m.sha256, receipts };
  }
  const passes = Array.isArray(r.passes) ? r.passes : [];
  const declared = mode === "model" ? t.values.repeats.n : 1;

  console.log("KIT", `sha256sums=${SHA256SUMS_SHA256}`);
  console.log("THRESHOLDS", `sha256=${t.sha256}`);
  console.log("RECEIPT", `sha256=${receipt.sha256}`, "schemaVersion=1", `mode=${mode}`, `status=${shown(r.status)}`, `passes=${passes.length}`);
  // The commitment the receipt names, printed for comparison with the signed COMMITMENT.json; not checked here.
  const named = isObject(r.commitment) ? r.commitment : {};
  console.log("COMMITMENT", `receipt=${shown(named.sha256 ?? null)}`, `ordinal=${shown(named.ordinal ?? null)}`);
  // The manifest check comes first among the binding checks.
  const binding = [];
  if (manifest) {
    console.log("MANIFEST", `sha256=${manifest.sha256}`, `receipts=${manifest.receipts.length}`);
    const entry = manifest.receipts.findIndex((e) => e.sha256 === receipt.sha256);
    if (entry < 0) binding.push("manifest");
    else console.log("MANIFEST", "match", `entry=${entry + 1}`);
  } else {
    console.log("UNVERIFIED", "manifest");
  }
  console.log("RUNTIME", `receipt=${shown(isObject(r.runtime) ? r.runtime.node : undefined)}`, `here=${process.version}`);
  if (isObject(r.input)) console.log("UNVERIFIED", "input.assemblySha256", `entityRows=${PARTIES.filter((p) => p.entity).length}`);
  else console.log("UNVERIFIED", "input");

  binding.push(...bindingProblems(r, t));
  if (binding.length) return mismatch(binding.map((k) => `RESCORE mismatch class=binding key=${k}`));
  const shape = shapeProblems(r, passes, mode, declared);
  if (shape.length) return mismatch(shape.map((k) => `RESCORE mismatch class=shape key=${k}`));

  const scored = scoreRun({
    parties: PARTIES,
    thresholds: t.values,
    mode,
    reason: r.reason || null,
    passes: passes.map((p) => ({ index: p.index, status: p.status, reason: p.reason || null, decisions: p.decisions })),
  });
  // Stopped before the first pass (assembly, probe, list version): the runner's stop is not recomputable.
  if (!passes.length) console.log("RUN", "UNVERIFIED", `class=${shown(r.reason.class)}`);
  scored.results.forEach(({ index, result, decisions }, i) => {
    if (scored.passes[i].decisions) console.log(decisionsLine(scored.passes[i]));
    const stopped = runnerStopped(passes[i]);
    if (stopped) console.log("PASS", index, "UNVERIFIED", `class=${shown(passes[i].reason.class)}`);
    // rerun and exit of a run of this mode made of this one pass.
    const single = summarize([{ index, result, decisions }], PARTIES, { mode, declared: 1, reason: stopped ? passes[i].reason : null });
    for (const line of passLines(`pass-${index}`, result, single)) console.log(line);
  });
  if (passes.length) console.log(aggLine(String(passes.length), scored.summary, passes[passes.length - 1].index));

  const diffs = valueDiffs(r, passes, scored, mode);
  // Differences in fractions alone, under another major runtime, are the arithmetic of another engine.
  const float =
    diffs.length > 0 &&
    major(isObject(r.runtime) ? r.runtime.node : null) !== major(process.version) &&
    diffs.every((d) => typeof d.a === "number" && typeof d.b === "number" && FRACTIONS.has(d.path.split(".").pop()));
  const cls = float ? "float" : "value";
  const lines = diffs.map((d) => `RESCORE mismatch class=${cls} key=${d.path} published=${shown(d.a)} rescored=${shown(d.b)}`);
  printMismatches(lines);
  if (scored.summary.status !== "completed") console.log("RERUN", scored.summary.rerun);
  console.log(lines.length ? "RESCORE mismatch" : "RESCORE match");
  return lines.length ? 6 : 0;
}
