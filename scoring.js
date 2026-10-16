/* Scoring of a run: one function for the runner and --rescore. It grades
   each pass with rubric.js and combines the passes into the receipt form.
   A pure module: no network, no files, no environment. */

import { createHash } from "node:crypto";
import { evaluate, evaluateStopped, summarize } from "./rubric.js";
import { rubricRules } from "./thresholds.js";

/* The keys of a decision row, in receipt order. A row is built from these
   keys alone, never copied from the object the candidate returns. */
export const DECISION_KEYS = {
  model: ["id", "decision", "error", "matchCalls", "topMatch", "returnedModelId", "params", "usage", "responseSha256"],
  baseline: ["id", "decision", "reason", "matchCalls", "score", "fuzzy", "topMatch", "error"],
};

/* A value that is missing is written as null, never left undefined: the
   canonical JSON of the rows refuses undefined. */
const errorOf = (e) => ({ class: e.class ?? null, status: e.status ?? null });

/* A model decision row: the decision, codes and numbers; never the model's text. */
export function modelDecision(row) {
  const rec = { id: row.id, decision: row.decision };
  if (row.error) rec.error = errorOf(row.error);
  rec.matchCalls = row.matchCalls || 0;
  if (row.topMatch) rec.topMatch = { id: row.topMatch.id ?? null, score: row.topMatch.score ?? null };
  rec.returnedModelId = row.returnedModelId ?? null;
  rec.params = row.params ?? null;
  if (row.usage) rec.usage = row.usage;
  rec.responseSha256 = row.responseSha256 ?? null;
  return rec;
}

/* A baseline decision row: its reason is a code, its numbers are computed locally. */
export function baselineDecision(row) {
  const rec = {
    id: row.id,
    decision: row.decision,
    reason: row.reason ?? null,
    matchCalls: row.matchCalls || 0,
    score: row.score ?? null,
  };
  const f = row.fuzzy;
  if (f) rec.fuzzy = { score: f.score ?? null, jw: f.jw ?? null, lev: f.lev ?? null, tokenSet: f.tokenSet ?? null };
  if (row.topMatch) {
    rec.topMatch = { id: row.topMatch.id ?? null, score: row.topMatch.score ?? null, schema: row.topMatch.schema ?? null };
  }
  if (row.error) rec.error = errorOf(row.error);
  return rec;
}

/* Canonical JSON (RFC 8785): no whitespace; the keys of every object sorted
   by UTF-16 code units; arrays in their order; numbers and strings as
   JSON.stringify writes them. A value that is not JSON (NaN, Infinity,
   undefined, a function) throws instead of becoming null. */
function canonicalJson(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("canonical JSON: a number is not finite");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${Array.from(v, (x) => canonicalJson(x)).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON: a value of type ${typeof v} is not JSON`);
}

/* decisionsSha256: the SHA-256 of the canonical JSON of the decision rows of
   one pass. The only place that reads a decision row whole; returns hex only. */
export function decisionsDigest(decisions) {
  return createHash("sha256").update(canonicalJson(decisions), "utf8").digest("hex");
}

/* A pass the runner stopped: not completed for a reason other than its invalid rows. */
export function runnerStopped(pass) {
  return pass.status === "not-completed" && Boolean(pass.reason) && pass.reason.class !== "invalid";
}

/* One pass. A pass the runner stopped is not graded by the gates: its rows
   before the stop give its numbers and the verdict of a certain failure.
   Any other pass is graded over the whole book. */
export function scorePass(pass, parties, rules) {
  return runnerStopped(pass)
    ? evaluateStopped(pass.decisions, parties, rules, pass.reason)
    : evaluate(pass.decisions, parties, rules);
}

/* One pass in the receipt. A completed pass carries its rubric and grade; a
   pass that is not completed carries its reason and numbers, and a rubric only
   with the verdict failed. `calls` is carried through when the runner gives it. */
function passRecord(pass, result) {
  const rec = { index: pass.index, status: result.status };
  if (result.status !== "completed") rec.reason = result.reason;
  if (pass.calls) rec.calls = pass.calls;
  if (pass.decisions) {
    rec.decisions = pass.decisions;
    rec.decisionsSha256 = decisionsDigest(pass.decisions);
  }
  if (result.status === "completed") {
    const rubric = { outcome: result.outcome, gate: result.gate, why: result.why, numbers: result.numbers, intervals: result.intervals };
    if (result.entity) rubric.entity = result.entity;
    rec.rubric = rubric;
    rec.grade = result.grade;
  } else {
    rec.numbers = result.numbers;
    if (result.rubric) rec.rubric = result.rubric;
  }
  return rec;
}

/* The run from its passes, in the form of the receipt.
   parties: the rows of the book; thresholds: parsed thresholds.json;
   mode: "baseline" | "model"; reason: what stopped the run before its first
   pass, if anything; passes: [{ index, status, reason, decisions, calls? }]
   in order, where status "not-completed" with a reason other than class
   "invalid" is a pass the runner stopped. Returns the pass records, the pass
   results, the run reason, the summary { status, rubric?, rerun? } and the
   number of completed passes. */
export function scoreRun({ parties, thresholds, mode, reason, passes }) {
  const rules = rubricRules(thresholds);
  const declared = mode === "model" ? thresholds.repeats.n : 1;
  const results = passes.map((p) => ({ index: p.index, result: scorePass(p, parties, rules), decisions: p.decisions }));
  const last = results[results.length - 1];
  // A stop inside a pass names the pass; a stop before the first pass is the runner's own reason.
  let runReason = null;
  if (!last) runReason = reason || null;
  else if (last.result.status !== "completed") runReason = { ...last.result.reason, pass: last.index };
  return {
    passes: passes.map((p, i) => passRecord(p, results[i].result)),
    results,
    reason: runReason,
    summary: summarize(results, parties, { mode, declared, reason: runReason }),
    completed: results.filter((r) => r.result.status === "completed").length,
  };
}

/* Result to exit code; one mapping for the runs, --rubric-test and --rescore. A
   run that is not completed exits 4, or 5 when it already has the verdict failed. */
export function exitCodeOf(summary) {
  if (summary.status === "not-completed") return summary.rubric ? 5 : 4;
  if (summary.rubric.outcome === "untested") return 1;
  return summary.rubric.outcome === "failed" ? 5 : 0;
}

const bound = (mr) => `missedRate=[${mr.lower.toFixed(4)},${mr.upper.toFixed(4)}] k=${mr.k} n=${mr.n}`;

/* The RUBRIC line of one pass and, for a completed pass, its CI, HIT and ENTITY
   lines. `single` is the summary of a run made of this one pass. */
export function passLines(name, result, single) {
  const n = result.numbers;
  if (result.status !== "completed") {
    const head = result.reason.class === "invalid" ? `invalid=${n.invalidN} fatal=${n.invalidFatal}` : `rows=${n.n}`;
    const verdict = result.rubric ? ` outcome=failed gate=${result.rubric.gate}` : "";
    return [`RUBRIC ${name} status=not-completed ${head} missed=${n.missedSanction}${verdict} rerun=${single.rerun} exit=${exitCodeOf(single)}`];
  }
  const precision = n.hitPrecision === null ? "null" : n.hitPrecision.toFixed(4);
  const lines = [
    `RUBRIC ${name} status=completed outcome=${result.outcome} gate=${result.gate} n=${n.n} missed=${n.missedSanction} hold=${n.holdDecisions} hitPrecision=${precision} invalid=${n.invalidN} manualShare=${n.manualShare.toFixed(4)} exit=${exitCodeOf(single)}`,
  ];
  const mr = result.intervals.missedRate;
  lines.push(mr ? `CI ${name} ${bound(mr)}` : `CI ${name} missedRate=null`);
  lines.push(`HIT ${name} correct=${n.hitCorrect} entityMatch=${n.hitEntityMatch} noListCall=${n.hitNoListCall}`);
  const e = result.entity;
  if (e) lines.push(`ENTITY ${name} entities=${e.entities} withHit=${e.withHit} missed=${e.missed} allHit=${e.allHit}`);
  return lines;
}

/* The DECISIONS line of a pass record that has decision rows. */
export function decisionsLine(rec) {
  return `DECISIONS pass-${rec.index} rows=${rec.decisions.length} sha256=${rec.decisionsSha256}`;
}

/* The AGG line of a run: `label` names its passes, `lastIndex` is its last pass. */
export function aggLine(label, summary, lastIndex) {
  const head = `AGG worst-pass passes=${label} status=${summary.status}`;
  const r = summary.rubric;
  if (summary.status === "completed") {
    return `${head} outcome=${r.outcome} gate=${r.gate} pass=${r.pass} agreement=${r.agreement.toFixed(4)} ${bound(r.intervals.missedRate)} exit=${exitCodeOf(summary)}`;
  }
  if (r) return `${head} outcome=failed gate=${r.gate} pass=${r.pass} rerun=${summary.rerun} exit=${exitCodeOf(summary)}`;
  return `${head} pass=${lastIndex} rerun=${summary.rerun} exit=${exitCodeOf(summary)}`;
}
