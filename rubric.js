/* Rules grader — the INSTRUMENT, not the candidate.
   Gold from data.js. Decisions from the candidate.
   Never an LLM. Holding a gold hold is a correct result.
   A pure module: every threshold arrives in `rules`, parsed from
   thresholds.json, and nothing here has a default. */

const KNOWN = new Set(["hit", "hold", "clear"]);
const SCOPE = "this SAMPLE book, not the task class";
const RANK = { failed: 0, "works-with-controls": 1, works: 2 };

/* The one place that decides which errors allow another try.
   at "row": the model request of a row lost its connection after retries
   (network, timeout, HTTP 429 or 5xx); such a row leaves the pass not
   completed, whatever the tolerance.
   at "stop": the runner stopped a pass on a list error; a rerun is allowed
   after a lost connection, an unreadable list response or a list version
   that does not match, not after another HTTP status. */
export function allowsRerun(error, at) {
  const cls = error && error.class;
  const status = error && error.status;
  const link =
    cls === "network" || cls === "timeout" || (cls === "http" && (status === 429 || (status >= 500 && status <= 599)));
  if (at === "row") return link;
  if (at === "stop") return link || cls === "parse" || cls === "version";
  return false;
}

function requireRules(rules) {
  const r = rules && rules.rubric;
  const i = rules && rules.intervals;
  const ok =
    r &&
    Number.isInteger(r.holdMax) &&
    Number.isInteger(r.worksHoldMax) &&
    typeof r.hitPrecisionMin === "number" &&
    r.invalid &&
    Number.isInteger(r.invalid.maxRows) &&
    r.invalid.withinTolerance === "hold" &&
    i &&
    i.method === "clopper-pearson-upper" &&
    typeof i.level === "number" &&
    Array.isArray(i.metrics) &&
    typeof rules.perEntity === "boolean";
  if (!ok) throw new Error("rubric rules are incomplete");
}

function indexById(decisions) {
  const byId = new Map();
  for (const d of decisions || []) if (d && d.id != null) byId.set(d.id, d);
  return byId;
}

/* One book row with its decision row, as the rubric reads them. */
function readRow(p, row) {
  const raw = row && typeof row.decision === "string" ? row.decision.trim().toLowerCase() : "";
  const decision = KNOWN.has(raw) ? raw : "invalid";
  const error = row && row.error && typeof row.error === "object" ? row.error : null;
  let errClass = null;
  if (decision === "invalid") errClass = !row ? "missing" : error && error.class ? error.class : "unparsed";
  return {
    p,
    row,
    decision,
    holdRow: p.gold === "hold" || p.mustHold === true,
    fatalRow: p.gold === "hit" || p.fatalIfClear === true,
    errClass,
    link: decision === "invalid" && allowsRerun(error, "row"),
  };
}

function countByClass(rows) {
  const out = {};
  for (const r of rows) out[r.errClass] = (out[r.errClass] || 0) + 1;
  return out;
}

/* Counts over the rows that have an answer (hit, hold or clear). */
function answeredCounts(rows) {
  const a = { missedSanction: 0, holdAnswers: 0, hitCorrect: 0, hitDecisions: 0 };
  for (const r of rows) {
    if (r.decision === "invalid") continue;
    if (r.fatalRow && r.decision === "clear") a.missedSanction += 1;
    if (r.decision === "hold") a.holdAnswers += 1;
    if (r.decision === "hit") {
      a.hitDecisions += 1;
      if (r.p.gold === "hit") a.hitCorrect += 1;
    }
  }
  return a;
}

/* Step 1b: a pass that is not completed still fails when the answered rows
   already make failure certain. `unanswered` counts gold hit rows without an
   answer: invalid ones and those the pass never reached. */
function certainFailure(a, unanswered, rules) {
  const { holdMax, hitPrecisionMin } = rules.rubric;
  if (a.missedSanction > 0) {
    return { outcome: "failed", gate: "missed-sanction", why: `${a.missedSanction} answered fatal row(s) posted as clear.` };
  }
  if (a.holdAnswers > holdMax) {
    return { outcome: "failed", gate: "hold-max", why: `${a.holdAnswers} hold answers already, above holdMax ${holdMax}.` };
  }
  if (a.hitDecisions > 0 && (a.hitCorrect + unanswered) / (a.hitDecisions + unanswered) < hitPrecisionMin) {
    return {
      outcome: "failed",
      gate: "hit-precision",
      why: `Best reachable hit precision (${a.hitCorrect} + ${unanswered}) / (${a.hitDecisions} + ${unanswered}) is below hitPrecisionMin ${hitPrecisionMin}.`,
    };
  }
  return null;
}

/* P(X <= k) for X ~ Binomial(n, p). */
function binomialCdf(k, n, p) {
  let term = Math.pow(1 - p, n);
  let sum = term;
  for (let j = 1; j <= k; j += 1) {
    term *= ((n - j + 1) / j) * (p / (1 - p));
    sum += term;
  }
  return sum;
}

/* Exact one-sided upper bound (Clopper-Pearson): the p at which P(X <= k | n, p) = 1 - level. */
function upperBound(k, n, level) {
  if (k === n) return 1;
  if (k === 0) return 1 - Math.pow(1 - level, 1 / n);
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 100; step += 1) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(k, n, mid) > 1 - level) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function intervalsOf(missedSanction, hitN, spec) {
  const out = { scope: SCOPE };
  for (const metric of spec.metrics) {
    if (metric === "missedRate") {
      out.missedRate = hitN === 0 ? null : { k: missedSanction, n: hitN, lower: 0, upper: upperBound(missedSanction, hitN, spec.level) };
    }
  }
  return out;
}

/* Per-entity numbers, no gate: rows of the book that carry an entity. */
function entityBlock(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.p.entity) continue;
    if (!by.has(r.p.entity)) by.set(r.p.entity, { hit: 0, answeredHit: 0, answeredClear: 0 });
    const e = by.get(r.p.entity);
    if (r.p.gold !== "hit") continue;
    e.hit += 1;
    if (r.decision === "hit") e.answeredHit += 1;
    if (r.decision === "clear") e.answeredClear += 1;
  }
  const withHit = [...by.entries()].filter(([, e]) => e.hit > 0);
  const missed = withHit.filter(([, e]) => e.answeredClear > 0).map(([id]) => id);
  return {
    entities: by.size,
    withHit: withHit.length,
    missed: missed.length,
    allHit: withHit.filter(([, e]) => e.answeredHit === e.hit).length,
    missedEntities: missed,
  };
}

/* One pass over the whole book. */
export function evaluate(decisions, parties, rules) {
  if (!parties || !parties.length) {
    return { status: "completed", outcome: "untested", gate: "untested", why: "No parties. Untested.", numbers: {}, grade: [] };
  }
  requireRules(rules);
  const byId = indexById(decisions);
  const rows = parties.map((p) => readRow(p, byId.get(p.id)));
  const n = rows.length;
  const invalid = rows.filter((r) => r.decision === "invalid");
  const invalidN = invalid.length;
  const invalidFatal = invalid.filter((r) => r.fatalRow).length;
  const invalidByClass = countByClass(invalid);
  const max = rules.rubric.invalid.maxRows;

  // Step 1: too many invalid rows, all rows, one on a fatal row, or one lost connection.
  if (invalidN > max || invalidN === n || invalidFatal > 0 || invalid.some((r) => r.link)) {
    const plain = invalid.filter((r) => !r.link);
    const rerun =
      plain.length > max || plain.length === n || plain.some((r) => r.fatalRow) ? "not-eligible" : "eligible";
    const a = answeredCounts(rows);
    const verdict = certainFailure(a, invalid.filter((r) => r.p.gold === "hit").length, rules);
    const out = {
      status: "not-completed",
      reason: { class: "invalid", count: invalidN, max, fatal: invalidFatal },
      numbers: { n, missedSanction: a.missedSanction, invalidN, invalidFatal, invalidByClass },
      rerun,
    };
    if (verdict) out.rubric = verdict;
    return out;
  }

  // Steps 2-4: an invalid row within tolerance counts as a hold answer everywhere.
  let hitCorrect = 0;
  let holdCorrect = 0;
  let clearCorrect = 0;
  let missedSanction = 0;
  let falseHit = 0;
  let hitOnHold = 0;
  let hitDecisions = 0;
  let holdDecisions = 0;
  let hitEntityMatch = 0;
  let hitNoListCall = 0;
  const manual = { correctHold: 0, holdOnHit: 0, holdOnClear: 0, falseHit: 0, hitOnHold: 0, clearOnHold: 0 };
  const grade = [];
  for (const r of rows) {
    const { p, row } = r;
    const answer = r.decision === "invalid" ? "hold" : r.decision;
    let ok = false;
    let fatal = false;
    if (answer === "hit") {
      hitDecisions += 1;
      if (p.gold === "hit") {
        hitCorrect += 1;
        ok = true;
        if (p.entity && row && row.topMatch && row.topMatch.id === p.entity) hitEntityMatch += 1;
        if (row && row.matchCalls === 0) hitNoListCall += 1;
      } else if (p.gold === "clear") {
        falseHit += 1;
        manual.falseHit += 1;
      } else if (r.holdRow) {
        hitOnHold += 1;
        manual.hitOnHold += 1;
      }
    }
    if (answer === "hold") {
      holdDecisions += 1;
      if (r.holdRow) {
        holdCorrect += 1;
        ok = true;
        manual.correctHold += 1;
      } else if (p.gold === "hit") manual.holdOnHit += 1;
      else manual.holdOnClear += 1;
    }
    if (answer === "clear") {
      if (p.gold === "clear") {
        clearCorrect += 1;
        ok = true;
      }
      if (r.fatalRow) {
        missedSanction += 1;
        fatal = true;
      }
      if (r.holdRow) manual.clearOnHold += 1;
    }
    grade.push({ id: p.id, gold: p.gold, decision: r.decision, ok, fatal });
  }

  const hitN = rows.filter((r) => r.p.gold === "hit").length;
  const manualN = Object.values(manual).reduce((s, v) => s + v, 0);
  const hitPrecision = hitDecisions === 0 ? null : hitCorrect / hitDecisions;
  const numbers = {
    n,
    hitN,
    holdN: rows.filter((r) => r.holdRow).length,
    clearN: rows.filter((r) => r.p.gold === "clear").length,
    hitCorrect,
    holdCorrect,
    clearCorrect,
    missedSanction,
    falseHit,
    hitOnHold,
    hitDecisions,
    holdDecisions,
    residualN: n - (hitCorrect + holdCorrect + clearCorrect),
    invalidN,
    invalidFatal,
    invalidByClass,
    hitEntityMatch,
    hitNoListCall,
    hitPrecision,
    manualN,
    manualShare: manualN / n,
    manual,
  };

  // Step 6: gates in order; the first that fires decides.
  const { holdMax, worksHoldMax, hitPrecisionMin } = rules.rubric;
  let outcome;
  let gate;
  let why;
  if (missedSanction > 0) {
    [outcome, gate, why] = ["failed", "missed-sanction", `${missedSanction} fatal row(s) posted as clear.`];
  } else if (holdDecisions === n) {
    [outcome, gate, why] = ["failed", "all-hold", `Hold on all ${n} rows.`];
  } else if (holdDecisions > holdMax) {
    [outcome, gate, why] = ["failed", "hold-max", `${holdDecisions} hold answers, above holdMax ${holdMax}.`];
  } else if (hitPrecision !== null && hitPrecision < hitPrecisionMin) {
    [outcome, gate, why] = ["failed", "hit-precision", `Hit precision ${hitCorrect} / ${hitDecisions}, below hitPrecisionMin ${hitPrecisionMin}.`];
  } else if (holdDecisions <= worksHoldMax) {
    [outcome, gate, why] = ["works", "hold-works", `No gate failed; ${holdDecisions} hold answers, within worksHoldMax ${worksHoldMax}.`];
  } else {
    [outcome, gate, why] = [
      "works-with-controls",
      "hold-controls",
      `No gate failed; ${holdDecisions} hold answers, above worksHoldMax ${worksHoldMax} and within holdMax ${holdMax}.`,
    ];
  }

  const out = { status: "completed", outcome, gate, why, numbers, intervals: intervalsOf(missedSanction, hitN, rules.intervals) };
  if (rules.perEntity) out.entity = entityBlock(rows);
  out.grade = grade;
  return out;
}

/* Step 1a: a pass the runner stopped on a list error. Only the rows before
   the stop count; the rows after it are not invalid, the pass never reached
   them. `reason` is the runner's { class, status }. */
export function evaluateStopped(decisions, parties, rules, reason) {
  requireRules(rules);
  const byId = indexById(decisions);
  const rows = parties.filter((p) => byId.has(p.id)).map((p) => readRow(p, byId.get(p.id)));
  const invalid = rows.filter((r) => r.decision === "invalid");
  const plain = invalid.filter((r) => !r.link);
  const max = rules.rubric.invalid.maxRows;
  const a = answeredCounts(rows);
  const unanswered =
    parties.filter((p) => p.gold === "hit" && !byId.has(p.id)).length + invalid.filter((r) => r.p.gold === "hit").length;
  const rerun =
    allowsRerun(reason, "stop") && plain.length <= max && !plain.some((r) => r.fatalRow) ? "eligible" : "not-eligible";
  const out = {
    status: "not-completed",
    reason,
    numbers: {
      n: rows.length,
      missedSanction: a.missedSanction,
      invalidN: invalid.length,
      invalidFatal: invalid.filter((r) => r.fatalRow).length,
      invalidByClass: countByClass(invalid),
    },
    rerun,
  };
  const verdict = certainFailure(a, unanswered, rules);
  if (verdict) out.rubric = verdict;
  return out;
}

function answerOf(row) {
  const raw = row && typeof row.decision === "string" ? row.decision.trim().toLowerCase() : "";
  return KNOWN.has(raw) ? raw : "invalid";
}

/* Share of rows where every pass gave the same answer; any answer outside
   hit | hold | clear is the one value "invalid". */
function agreementOf(passes, parties) {
  const maps = passes.map(({ decisions }) => indexById(decisions));
  let same = 0;
  for (const p of parties) {
    const answers = maps.map((m) => answerOf(m.get(p.id)));
    if (answers.every((x) => x === answers[0])) same += 1;
  }
  return same / parties.length;
}

/* The run from its passes: one function for the runner and --rubric-test.
   passes: [{ index, result, decisions }] in order, up to the pass that
   stopped; mode: "baseline" | "model"; declared: passes the run should make;
   reason: what stopped the run, if anything. Returns { status, rubric?, rerun? }. */
export function summarize(passes, parties, { mode, declared, reason }) {
  if (!passes.length) {
    // Stopped before the first pass (probe, list version, assembly): any class allows a rerun.
    return { status: "not-completed", rerun: reason ? "eligible" : "not-eligible" };
  }
  const failed = passes.find(({ result }) => (result.status === "completed" ? result.outcome === "failed" : Boolean(result.rubric)));
  const last = passes[passes.length - 1];
  if (last.result.status !== "completed" || passes.length < declared) {
    const out = { status: "not-completed" };
    if (failed) {
      const f = failed.result.status === "completed" ? failed.result : failed.result.rubric;
      out.rubric = { rule: "not-completed-verdict", pass: failed.index, outcome: "failed", gate: f.gate, why: `Pass ${failed.index}: ${f.why}` };
    }
    const passRerun = last.result.status === "completed" ? "not-eligible" : last.result.rerun;
    // A model run with a verdict may not be tried again; the deterministic baseline may.
    out.rerun = mode === "model" && failed ? "not-eligible" : passRerun;
    return out;
  }

  let worst = passes[0];
  for (const p of passes) if (RANK[p.result.outcome] < RANK[worst.result.outcome]) worst = p;
  let bound = passes[0];
  for (const p of passes) if (p.result.numbers.missedSanction > bound.result.numbers.missedSanction) bound = p;
  const intervals = { ...bound.result.intervals };
  if (intervals.missedRate) intervals.missedRate = { ...intervals.missedRate, pass: bound.index };
  const w = worst.result;
  const rubric = { rule: "worst-pass", pass: worst.index, outcome: w.outcome, gate: w.gate, why: w.why, numbers: w.numbers, intervals };
  if (w.entity) rubric.entity = w.entity;
  rubric.agreement = agreementOf(passes, parties);
  return { status: "completed", rubric };
}

export function outcomeLabel(v) {
  if (v === "works") return "works";
  if (v === "works-with-controls") return "works with controls";
  if (v === "failed") return "fails this pack";
  return "untested";
}

export function statusLabel(v) {
  if (v === "completed") return "completed";
  if (v === "not-completed") return "run not completed";
  return v;
}
