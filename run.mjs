import { SHA256SUMS_SHA256 } from "./integrity.js"; // first: digests are checked before any other code of the kit runs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Loaded only after the digest check, so a changed file exits 3 even when it does not parse. */
const { COUNTS, META, PARTIES } = await import("./data.js");
const { evaluate, evaluateStopped, summarize } = await import("./rubric.js");
const { aggLine, baselineDecision, decisionsLine, exitCodeOf, modelDecision, passLines, scorePass, scoreRun } =
  await import("./scoring.js");
const { commitmentLine, configDifferences, freezeCheck } = await import("./commitment.js");

const here = dirname(fileURLToPath(import.meta.url));

const MODES = ["--check", "--freeze-check", "--list-ping", "--model-ping", "--assemble", "--rubric-test", "--baseline", "--model"];
const USAGE = [
  "Usage: node run.mjs <mode>, exactly one of:",
  "  --check       report the pack and the snapshot description; no keys, no network",
  "  --freeze-check check the frozen files and the pre-run commitment; no keys, no network",
  "  --list-ping   send one invented probe to the list server",
  "  --model-ping  send one invented message to the model, without tools or book rows",
  "  --assemble    build the book rows from the list export and print their digests; no network",
  "  --rubric-test run synthetic answers through the grader; no keys, no network",
  "  --baseline    run the deterministic baseline on the book",
  "  --model       run the named model on the book",
  "  --rescore <receipt> [--manifest <result manifest>]",
  "                grade a published receipt again from its decisions; no keys, no network",
].join("\n");

const args = process.argv.slice(2);
const isPath = (a) => typeof a === "string" && a !== "" && !a.startsWith("--");
// --rescore takes the receipt, then optionally --manifest and the manifest; every other mode stands alone.
const rescoreArgs =
  args[0] === "--rescore" &&
  isPath(args[1]) &&
  (args.length === 2 || (args.length === 4 && args[2] === "--manifest" && isPath(args[3])));
if (!rescoreArgs && (args.length !== 1 || !MODES.includes(args[0]))) {
  console.error(USAGE);
  process.exit(2);
}
const mode = args[0];

// Before .env is read: --rescore needs no setting, key or network.
if (mode === "--rescore") {
  const { rescore } = await import("./rescore.js");
  process.exit(rescore(args[1], args.length === 4 ? args[3] : null));
}

// Also before .env is read: the freeze check reads the files of the kit only.
if (mode === "--freeze-check") {
  const check = freezeCheck();
  for (const line of check.findings) console.log(line);
  console.log(check.findings.length ? "FREEZE failed" : `FREEZE ok ordinal=${check.ordinal} sha256=${check.sha256}`);
  process.exit(check.findings.length ? 2 : 0);
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnv(join(here, ".env"));

function printCheck() {
  const status = loadPackStatus();
  console.log("PACK", META.id);
  console.log("TITLE", META.title);
  console.log("BOOK_VERSION", META.bookVersion);
  console.log("PACK_STATUS", packStatusLine(status));
  if (!status.invalid.length) console.log("BANNER", bannerOf(status));
  console.log("COUNTS", JSON.stringify(COUNTS));
  const book = bookCounts(PARTIES);
  console.log("BOOK", `entity=${book.entity}`, `literal=${book.literal}`, `entities=${book.entities}`);
  console.log("FATAL", META.fatal);
  console.log("LIST", "OpenSanctions", "/match", "at LIST_BASE_URL", "dataset = snapshot.json scope");
  console.log("SNAPSHOT", snapshotStatus());
  console.log("THRESHOLDS", thresholdsStatus(loadThresholds()));
  console.log("RECEIPT", `schemaVersion=${SCHEMA_VERSION}`);
  console.log("COMMITMENT", commitmentLine());
  console.log("BASELINE", "baseline.ofac-style-fuzzy.v1", "node run.mjs --baseline");
}

const { endpointPath, listPing, listSetup, pingExpectedVersion, requireSnapshot, snapshotBlock, snapshotStatus } =
  await import("./list.js");
const { callCounts, callsSince, closeRun, logEvent, openRun, readRunSettings, setPass, writeReceipt } =
  await import("./runlog.js");
const { assembleBook, bookCounts, checkExport } = await import("./assemble.js");
const { loadThresholds, rubricRules, thresholdsProblem, thresholdsStatus } = await import("./thresholds.js");
const { bannerOf, loadPackStatus, packStatusBlock, packStatusLine, packStatusProblem } = await import("./packstatus.js");

/* The shape of the receipts; see README "Receipt schema". */
const SCHEMA_VERSION = 1;

if (mode === "--check") {
  printCheck();
  process.exit(0);
}

function failConfig(message) {
  console.error(message);
  process.exit(2);
}

function failWith(err) {
  console.error(err && err.message ? err.message : err);
  process.exit(err && err.exitCode ? err.exitCode : 1);
}

/* Creates runs/ and opens the log. Failing here is a refusal before any network call. */
function startRun(settings) {
  try {
    return openRun(mode.slice(2), settings);
  } catch (err) {
    failConfig(`Cannot open the run log in runs/${err && err.code ? ` (${err.code})` : ""}. Nothing sent.`);
  }
}

/* What stopped a run: a class from the closed set and the HTTP status, never the error text. */
function reasonOf(err) {
  return { class: err.errorClass, status: err.httpStatus ?? null };
}

/* The REASON line: the class, then what belongs to it, then the pass when the stop was inside one. */
function reasonWords(reason) {
  const words = [reason.class];
  if (reason.class === "assembly") words.push(`code=${reason.code}`, `row=${reason.row}`);
  else if (reason.class === "invalid") words.push(`count=${reason.count}`, `max=${reason.max}`, `fatal=${reason.fatal}`);
  else words.push(reason.status);
  if (reason.pass != null) words.push(`pass=${reason.pass}`);
  return words;
}

/* The closing lines of every run. The pings write no receipt, so they have no WROTE. */
function printRunEnd(runId, reason, calls, log, wrote) {
  const c = (k) => `${k} ok=${calls[k].ok} failed=${calls[k].failed} retries=${calls[k].retries}`;
  console.log("RUN", runId);
  console.log("STATUS", reason ? "not-completed" : "completed");
  if (reason) console.log("REASON", ...reasonWords(reason));
  console.log("CALLS", c("list"), c("model"));
  console.log("LOG", `runs/${log.file}`, log.sha256);
  if (wrote) console.log("WROTE", `runs/${wrote}`);
}

/* An unexpected error once the log is open: the log is closed and its digest
   printed, so it stays whole and identifiable. No receipt; exit 1. */
function failInRun(runId, err) {
  logEvent("error", { kind: "unexpected", error: err && err.stack ? err.stack : String(err) });
  const log = closeRun();
  console.error(err && err.message ? err.message : err);
  console.log("RUN", runId);
  console.log("STATUS", "not-completed");
  console.log("LOG", `runs/${log.file}`, log.sha256);
  process.exit(1);
}

/* Every cell of thresholds.json set and valid, or exit 2 before any network call and before runs/. */
function thresholdsOrFail() {
  const t = loadThresholds();
  const problem = thresholdsProblem(t);
  if (problem) failConfig(problem);
  return t;
}

if (mode === "--list-ping") {
  let settings;
  let state;
  let expected;
  try {
    settings = readRunSettings();
    state = listSetup();
    expected = pingExpectedVersion();
  } catch (err) {
    failWith(err);
  }
  const runId = startRun(settings);
  let reason = null;
  let message = "";
  try {
    const out = await listPing(state);
    console.log("LIST_PING", out.dataset, out.served || "version:null", "candidates", (out.candidates || []).length);
    if (expected != null && out.served !== expected) {
      message = `List version mismatch: served "${out.served}", snapshot.json listVersion "${expected}".`;
      console.error(message);
      reason = { class: "version", status: out.status };
    }
  } catch (err) {
    if (!err || !err.errorClass) failInRun(runId, err);
    reason = reasonOf(err);
    message = err.message;
  }
  if (reason) logEvent("stop", { ...reason, error: message });
  const calls = callCounts();
  const log = closeRun();
  printRunEnd(runId, reason, calls, log, null);
  process.exit(reason ? 4 : 0);
}

if (mode === "--model-ping") {
  const { modelParams, modelPing, requireCandidate } = await import("./candidate.js");
  let settings;
  let cfg;
  try {
    settings = readRunSettings();
    cfg = requireCandidate();
  } catch (err) {
    failWith(err);
  }
  const runId = startRun(settings);
  let reason = null;
  try {
    const out = await modelPing(cfg);
    console.log("MODEL_PING", `status=${out.status}`, `returnedModelId=${out.returnedModelId}`, `params=${JSON.stringify(out.params)}`);
    console.log("RESPONSE", `sha256=${out.responseSha256}`);
  } catch (err) {
    if (!err || !err.errorClass) failInRun(runId, err);
    reason = reasonOf(err);
    logEvent("stop", { ...reason, error: err.message });
    console.log("MODEL_PING", `status=${reason.status}`, "returnedModelId=null", `params=${JSON.stringify(modelParams(cfg))}`);
    console.log("RESPONSE", "sha256=null");
  }
  const calls = callCounts();
  const log = closeRun();
  printRunEnd(runId, reason, calls, log, null);
  process.exit(reason ? 4 : 0);
}

/* Refusals about the export (exit 2), before runs/ and the log. */
async function exportOrFail(snapshot) {
  try {
    return await checkExport(snapshot);
  } catch (err) {
    failWith(err);
  }
}

if (mode === "--assemble") {
  let path;
  try {
    path = await checkExport(requireSnapshot());
  } catch (err) {
    failWith(err);
  }
  let book;
  try {
    book = await assembleBook(PARTIES, path);
  } catch (err) {
    if (!err || err.errorClass !== "assembly") failWith(err);
    console.log("ASSEMBLY", "not-completed", `row=${err.row}`, `code=${err.code}`);
    process.exit(4);
  }
  for (const row of book.rows) console.log("ROW", row.id, row.source, row.inputSha256);
  const counts = bookCounts(PARTIES);
  console.log(
    "ASSEMBLY",
    "completed",
    `rows=${book.rows.length}`,
    `entity=${counts.entity}`,
    `literal=${counts.literal}`,
    `sha256=${book.assemblySha256}`,
  );
  process.exit(0);
}

/* --rubric-test: synthetic answers built from the ids, gold and entities of
   the book alone, run through the grader and the run summary only. Each set
   differs from "perfect" only as its name says. */
function rubricSets(parties) {
  const perfect = () =>
    parties.map((p) => {
      const row = { id: p.id, decision: p.gold, matchCalls: 1 };
      if (p.entity) row.topMatch = { id: p.entity };
      return row;
    });
  // Changes the first k rows of the given gold, in book order.
  const first = (rows, gold, k, change) => {
    let left = k;
    parties.forEach((p, i) => {
      if (left > 0 && p.gold === gold) {
        change(rows[i]);
        left -= 1;
      }
    });
    return rows;
  };
  const answer = (decision) => (r) => {
    r.decision = decision;
    delete r.error;
  };
  const failure = (cls, status) => (r) => {
    r.decision = "invalid";
    r.error = { class: cls, status };
  };
  const timeout = failure("timeout", null);
  const all = (decision) => perfect().map((r) => ({ ...r, decision }));
  const firstClear = parties.findIndex((p) => p.gold === "clear");
  // A pass the runner stopped on a list error at the first gold clear row.
  const stopped = (rows, stop) => ({ decisions: rows.slice(0, firstClear), stop });
  const network = { class: "network", status: null };
  const sets = new Map([
    ["all-hold", { decisions: all("hold") }],
    ["all-hit", { decisions: all("hit") }],
    ["all-clear", { decisions: all("clear") }],
    ["all-invalid", { decisions: all("x") }],
    ["empty", { decisions: [] }],
    ["perfect", { decisions: perfect() }],
    ["one-missed", { decisions: first(perfect(), "hit", 1, answer("clear")) }],
    ["hits-held", { decisions: first(perfect(), "hit", Infinity, answer("hold")) }],
  ]);
  for (const k of [3, 4, 6, 7]) sets.set(`clear-held-${k}`, { decisions: first(perfect(), "clear", k, answer("hold")) });
  for (const k of [6, 7]) sets.set(`false-hit-${k}`, { decisions: first(perfect(), "clear", k, answer("hit")) });
  for (const k of [2, 3]) sets.set(`invalid-${k}`, { decisions: first(perfect(), "clear", k, answer("x")) });
  sets.set("invalid-on-hit-1", { decisions: first(perfect(), "hit", 1, answer("x")) });
  sets.set("no-call-1", {
    decisions: first(perfect(), "hit", 1, (r) => {
      r.matchCalls = 0;
      delete r.topMatch;
    }),
  });
  sets.set("other-entity-1", { decisions: first(perfect(), "hit", 1, (r) => (r.topMatch = { id: "x" })) });
  sets.set("timeout-on-hit-1", { decisions: first(perfect(), "hit", 1, timeout) });
  sets.set("http-503-on-hit-1", { decisions: first(perfect(), "hit", 1, failure("http", 503)) });
  sets.set("http-400-on-hit-1", { decisions: first(perfect(), "hit", 1, failure("http", 400)) });
  sets.set("invalid-2-timeout-1", { decisions: first(first(perfect(), "clear", 3, timeout), "clear", 2, answer("x")) });
  sets.set("clear-held-5-timeout-2", { decisions: first(first(perfect(), "clear", 7, timeout), "clear", 5, answer("hold")) });
  sets.set("invalid-3-missed-1", { decisions: first(first(perfect(), "clear", 3, answer("x")), "hit", 1, answer("clear")) });
  sets.set("clear-held-7-timeout-on-hit-1", { decisions: first(first(perfect(), "clear", 7, answer("hold")), "hit", 1, timeout) });
  sets.set("false-hit-7-timeout-on-hit-1", { decisions: first(first(perfect(), "clear", 7, answer("hit")), "hit", 1, timeout) });
  sets.set("false-hit-6-timeout-on-hit-2", { decisions: first(first(perfect(), "clear", 6, answer("hit")), "hit", 2, timeout) });
  sets.set("list-stop", stopped(perfect(), network));
  sets.set("list-stop-missed", stopped(first(perfect(), "hit", 1, answer("clear")), network));
  sets.set("list-stop-invalid-on-hit-1", stopped(first(perfect(), "hit", 1, answer("x")), network));
  sets.set("list-stop-http-400", stopped(perfect(), { class: "http", status: 400 }));
  return sets;
}

const AGG_LISTS = [
  ["perfect", "perfect", "perfect"],
  ["perfect", "perfect", "one-missed"],
  ["perfect", "clear-held-4", "clear-held-3"],
  ["perfect", "false-hit-7", "perfect"],
  ["perfect", "invalid-on-hit-1", "perfect"],
  ["perfect", "list-stop"],
  ["perfect", "list-stop-missed"],
  ["one-missed", "timeout-on-hit-1"],
  ["clear-held-7", "timeout-on-hit-1"],
  ["clear-held-7", "list-stop-missed"],
  ["perfect", "false-hit-7-timeout-on-hit-1"],
];

if (mode === "--rubric-test") {
  const thresholds = thresholdsOrFail();
  const rules = rubricRules(thresholds.values);
  console.log("THRESHOLDS", `sha256=${thresholds.sha256}`);
  const results = new Map();
  for (const [name, set] of rubricSets(PARTIES)) {
    const result = set.stop
      ? evaluateStopped(set.decisions, PARTIES, rules, set.stop)
      : evaluate(set.decisions, PARTIES, rules);
    results.set(name, { result, decisions: set.decisions });
    // As a model run of this one pass.
    const single = summarize([{ index: 1, result, decisions: set.decisions }], PARTIES, {
      mode: "model",
      declared: 1,
      reason: set.stop || null,
    });
    for (const line of passLines(name, result, single)) console.log(line);
  }
  for (const list of AGG_LISTS) {
    // The runner makes no pass after one that is not completed.
    const passes = [];
    for (const [i, name] of list.entries()) {
      const { result, decisions } = results.get(name);
      passes.push({ index: i + 1, result, decisions });
      if (result.status !== "completed") break;
    }
    const last = passes[passes.length - 1];
    const summary = summarize(passes, PARTIES, { mode: "model", declared: list.length, reason: last.result.reason || null });
    console.log(aggLine(list.join(","), summary, last.index));
  }
  process.exit(0);
}

/* The receipt block for the assembled book: ids, recipes and digests, never the assembled values. */
function inputBlock(book) {
  return {
    recipeVersion: META.recipeVersion,
    assemblySha256: book.assemblySha256,
    parties: book.rows.map((r) =>
      r.source === "entity"
        ? { id: r.id, source: "entity", entity: r.entity, recipe: r.recipe, inputSha256: r.inputSha256 }
        : { id: r.id, source: "literal", inputSha256: r.inputSha256 },
    ),
  };
}

/* --baseline and --model: the book is assembled from the export, then one
   probe, then `declared` passes over the assembled rows, each graded on its
   own. A book that does not assemble, or a probe that fails, stops the run
   before the first pass. Inside a pass, a list request that fails after
   retries or a list version that does not match stops the run, and so does a
   pass the grader leaves not completed: no later pass runs. A model error
   only makes its row invalid. Each pass is { index, status, reason,
   decisions, calls }, status "not-completed" when the runner stopped it; the
   grading in the receipt is scoreRun over these passes. */
async function sitBook(runId, listState, exportPath, declared, rules, adjudicate, record) {
  let book;
  try {
    book = await assembleBook(PARTIES, exportPath);
  } catch (err) {
    if (!err || err.errorClass !== "assembly") failInRun(runId, err);
    const reason = { class: "assembly", code: err.code, row: err.row };
    logEvent("stop", reason);
    return { book: null, passes: [], reason };
  }
  try {
    await listPing(listState);
  } catch (err) {
    if (!err || !err.errorClass) failInRun(runId, err);
    logEvent("stop", { class: err.errorClass, status: err.httpStatus ?? null, error: err.message });
    return { book, passes: [], reason: reasonOf(err) };
  }
  const passes = [];
  for (let index = 1; index <= declared; index += 1) {
    setPass(index);
    const start = callCounts();
    const decisions = [];
    let status = "completed";
    let stop = null;
    try {
      for (const row of book.rows) decisions.push(record(await adjudicate(row.party)));
    } catch (err) {
      if (!err || !err.errorClass) failInRun(runId, err);
      logEvent("stop", { class: err.errorClass, status: err.httpStatus ?? null, error: err.message });
      status = "not-completed";
      stop = reasonOf(err);
    }
    const pass = { index, status, reason: stop, decisions, calls: callsSince(start) };
    passes.push(pass);
    const result = scorePass(pass, PARTIES, rules);
    if (result.status !== "completed") {
      if (result.reason.class === "invalid") logEvent("stop", result.reason);
      setPass(null);
      return { book, passes, reason: { ...result.reason, pass: index } };
    }
  }
  setPass(null);
  return { book, passes, reason: null };
}

/* The lines after the run lines: thresholds digest, one line per pass with the
   digest of its decision rows, the summary, the rerun. */
function printGrading(thresholds, scored) {
  const summary = scored.summary;
  console.log("THRESHOLDS", `sha256=${thresholds.sha256}`);
  scored.results.forEach(({ index, result }, i) => {
    if (result.status === "completed") {
      console.log("PASS", index, "STATUS", "completed", "OUTCOME", result.outcome, "GATE", result.gate);
    } else {
      const verdict = result.rubric ? ["OUTCOME", "failed", "GATE", result.rubric.gate] : [];
      console.log("PASS", index, "STATUS", "not-completed", "CLASS", result.reason.class, "MISSED", result.numbers.missedSanction, ...verdict);
    }
    console.log(decisionsLine(scored.passes[i]));
  });
  if (summary.rubric) {
    console.log("OUTCOME", summary.rubric.outcome);
    console.log("GATE", summary.rubric.gate);
  }
  if (summary.status === "completed") console.log("NUMBERS", JSON.stringify(summary.rubric.numbers));
  else console.log("RERUN", summary.rerun);
}

/* The pack status must be valid and accept the book as it is now, or exit 2 before any network call and before runs/. */
function packStatusOrFail() {
  const s = loadPackStatus();
  const problem = packStatusProblem(s);
  if (problem) failConfig(problem);
  return s;
}

/* The commitment a run names in its receipt, read once before the run:
   { ordinal, sha256 } when every freeze check passes, else null. */
function commitmentRef(check) {
  return check.findings.length ? null : { ordinal: check.ordinal, sha256: check.sha256 };
}

/* Every receipt of --baseline and --model, keys in one order. Only the
   candidate block, the deviations (model) and the repeats differ between the
   two; the caller passes them. Status, reason, rerun, passes and rubric are
   scoreRun's, the function --rescore uses. Built after the last pass, so
   `when` is the time the receipt was written. */
function buildReceipt({ runId, book, scored, settings, listState, packStatus, commitment, thresholds, calls, log, candidate, deviations, toolsAllowed, repeats }) {
  const summary = scored.summary;
  return {
    schemaVersion: SCHEMA_VERSION,
    licence: "CC-BY-NC-4.0",
    runId,
    status: summary.status,
    ...(scored.reason ? { reason: scored.reason } : {}),
    ...(summary.status === "not-completed" ? { rerun: summary.rerun } : {}),
    kit: { sha256sums: SHA256SUMS_SHA256 },
    packStatus: packStatusBlock(packStatus),
    commitment,
    meta: {
      id: META.id,
      pack: META.pack,
      bookVersion: META.bookVersion,
      title: META.title,
      banner: bannerOf(packStatus),
      fatal: META.fatal,
    },
    when: new Date().toISOString(),
    runtime: { node: process.version },
    run: settings,
    candidate,
    ...(deviations ? { deviations } : {}),
    toolsAllowed,
    list: { vendor: "OpenSanctions", endpoint: endpointPath(listState.dataset) },
    snapshot: snapshotBlock(listState.snapshot),
    ...(book ? { input: inputBlock(book) } : {}),
    thresholdsSha256: thresholds.sha256,
    thresholds: thresholds.values,
    repeats,
    calls,
    log,
    passes: scored.passes,
    ...(summary.rubric ? { rubric: summary.rubric } : {}),
  };
}

if (mode === "--baseline") {
  const { adjudicateParty, baselineMeta, TOOLS_ALLOWED } = await import("./baseline.js");
  let settings;
  let listState;
  try {
    settings = readRunSettings();
    listState = listSetup({ useSnapshot: true });
  } catch (err) {
    failWith(err);
  }
  const thresholds = thresholdsOrFail();
  const packStatus = packStatusOrFail();
  // A rehearsal before the commitment names none.
  const commitment = commitmentRef(freezeCheck());
  const exportPath = await exportOrFail(listState.snapshot);
  const runId = startRun(settings);
  const sit = await sitBook(
    runId,
    listState,
    exportPath,
    1,
    rubricRules(thresholds.values),
    (party) => adjudicateParty(party, listState, thresholds.values.baseline),
    baselineDecision,
  );
  const scored = scoreRun({ parties: PARTIES, thresholds: thresholds.values, mode: "baseline", reason: sit.reason, passes: sit.passes });
  const bl = baselineMeta();
  const calls = callCounts();
  const log = closeRun();
  const artifact = buildReceipt({
    runId,
    book: sit.book,
    scored,
    settings,
    listState,
    packStatus,
    commitment,
    thresholds,
    calls,
    log,
    candidate: { name: bl.id, kind: bl.kind, family: bl.family, notModel: true, methods: bl.methods },
    toolsAllowed: TOOLS_ALLOWED,
    repeats: { n: 1 },
  });
  const wrote = writeReceipt(artifact, "baseline-latest.json");
  console.log("PACK", META.id);
  console.log("BANNER", bannerOf(packStatus));
  console.log("BASELINE", bl.id);
  printRunEnd(runId, scored.reason, calls, log, wrote);
  printGrading(thresholds, scored);
  process.exit(exitCodeOf(scored.summary));
}

/* The model run is meant to see one model id and send one set of parameters.
   Anything else is recorded in the receipt, not hidden. */
function modelDeviations(requested, ids, decisions) {
  const out = [];
  if (ids.length > 1) out.push({ kind: "returned-model-ids", ids });
  const sets = [...new Set(decisions.map((d) => JSON.stringify(d.params)))];
  if (sets.length > 1) out.push({ kind: "params", sets: sets.map((s) => JSON.parse(s)) });
  const rows = decisions.filter((d) => d.returnedModelId != null && d.returnedModelId !== requested).map((d) => d.id);
  if (rows.length) out.push({ kind: "returned-model-id-differs", requested, rows });
  return out;
}

// --model: every other mode has exited above.
const {
  SYSTEM_PROMPT_SHA256,
  adjudicateParty,
  modelParams,
  requireCandidate,
  returnedModelIds,
  TOOLS_ALLOWED,
} = await import("./candidate.js");

let settings;
let listState;
let cfg;
try {
  settings = readRunSettings();
  listState = listSetup({ useSnapshot: true });
} catch (err) {
  failWith(err);
}
const thresholds = thresholdsOrFail();
const packStatus = packStatusOrFail();
try {
  cfg = requireCandidate();
} catch (err) {
  failWith(err);
}
// The model runs only under a complete commitment whose candidate and run blocks are the settings in force.
const check = freezeCheck();
if (check.findings.length) failConfig("COMMITMENT: the freeze check fails (node run.mjs --freeze-check). Nothing sent.");
const differs = configDifferences(cfg, settings);
if (differs.length) failConfig(`COMMITMENT.json: candidate or run differs from ${differs.join(", ")}. Nothing sent.`);
const commitment = commitmentRef(check);

const declared = thresholds.values.repeats.n;
const exportPath = await exportOrFail(listState.snapshot);
const runId = startRun(settings);
const sit = await sitBook(
  runId,
  listState,
  exportPath,
  declared,
  rubricRules(thresholds.values),
  (party) => adjudicateParty(party, cfg, listState),
  // The model's own reason text stays in the log; the receipt keeps the decision.
  modelDecision,
);

const scored = scoreRun({ parties: PARTIES, thresholds: thresholds.values, mode: "model", reason: sit.reason, passes: sit.passes });
const calls = callCounts();
const log = closeRun();
const allDecisions = sit.passes.flatMap((p) => p.decisions);

const artifact = buildReceipt({
  runId,
  book: sit.book,
  scored,
  settings,
  listState,
  packStatus,
  commitment,
  thresholds,
  calls,
  log,
  candidate: {
    name: cfg.name,
    provider: cfg.provider,
    apiStyle: cfg.style,
    thinking: cfg.thinking || null,
    params: modelParams(cfg),
    returnedModelIds: returnedModelIds(),
    systemPromptSha256: SYSTEM_PROMPT_SHA256,
  },
  deviations: modelDeviations(cfg.name, returnedModelIds(), allDecisions),
  toolsAllowed: TOOLS_ALLOWED,
  repeats: {
    n: declared,
    aggregation: thresholds.values.repeats.aggregation,
    completed: scored.completed,
  },
});

const wrote = writeReceipt(artifact, "latest.json");

console.log("PACK", META.id);
console.log("BANNER", bannerOf(packStatus));
console.log("CANDIDATE", cfg.name);
printRunEnd(runId, scored.reason, calls, log, wrote);
printGrading(thresholds, scored);
process.exit(exitCodeOf(scored.summary));
