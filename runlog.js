/* Run files and the run log. Every network request of --list-ping, --baseline
   and --model goes through request(): it is logged, timed out, retried and
   counted here. The log runs/<runId>.log.jsonl stays local: it holds book rows
   and service responses. Headers are never logged, and key values are
   replaced by [redacted]. */

import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runsDir = join(here, "runs");

const TIMER_MAX = 2147483647;
const RETRY_DELAY_MS = 1000;
const SECRET_VARS = ["OPENSANCTIONS_API_KEY", "CANDIDATE_API_KEY"];

let run = null;

function configError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function intSetting(name, fallback, min, max) {
  const raw = (process.env[name] || "").trim();
  if (raw === "") return fallback;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= min && n <= max)) {
    const range = max === Infinity ? `of at least ${min}` : `from ${min} to ${max}`;
    throw configError(`${name} must be an integer ${range}. Nothing sent.`);
  }
  return n;
}

/* Effective timeouts and retries of a run. Read before the run starts; written into the receipt. */
export function readRunSettings() {
  return {
    listTimeoutMs: intSetting("LIST_TIMEOUT_MS", 30000, 1, TIMER_MAX),
    modelTimeoutMs: intSetting("MODEL_TIMEOUT_MS", 120000, 1, TIMER_MAX),
    retryMax: intSetting("RETRY_MAX", 2, 0, Infinity),
    retryDelayMs: RETRY_DELAY_MS,
  };
}

function redact(text) {
  let out = text;
  for (const secret of run.secrets) {
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) {
      out = out.split(form).join("[redacted]");
    }
  }
  return out;
}

/* One JSON line per event; during a pass it carries the pass number. Does nothing when no log is open. */
export function logEvent(event, fields = {}) {
  if (!run || run.fd == null) return;
  const pass = run.pass != null ? { pass: run.pass } : {};
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...pass, ...fields });
  writeSync(run.fd, `${redact(line)}\n`);
}

/* The pass the next events belong to; null outside the passes (start, assembly, probe, end). */
export function setPass(index) {
  if (run) run.pass = index;
}

/* Creates runs/ and opens the log; called before the first network call. Returns the runId. */
export function openRun(mode, settings) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const runId = `${mode}-${stamp}-${randomBytes(3).toString("hex")}`;
  mkdirSync(runsDir, { recursive: true });
  const logFile = `${runId}.log.jsonl`;
  const fd = openSync(join(runsDir, logFile), "wx");
  const secrets = SECRET_VARS.map((k) => (process.env[k] || "").trim()).filter(Boolean);
  const zero = () => ({ ok: 0, failed: 0, retries: 0 });
  run = { runId, settings, logFile, fd, secrets, calls: { list: zero(), model: zero() } };
  logEvent("run-start", { runId, settings });
  return runId;
}

export function callCounts() {
  return { list: { ...run.calls.list }, model: { ...run.calls.model } };
}

export function callsSince(before) {
  const now = callCounts();
  const diff = (k) => ({
    ok: now[k].ok - before[k].ok,
    failed: now[k].failed - before[k].failed,
    retries: now[k].retries - before[k].retries,
  });
  return { list: diff("list"), model: diff("model") };
}

function requestError(errorClass, httpStatus, message) {
  const err = new Error(message);
  err.errorClass = errorClass;
  err.httpStatus = httpStatus;
  return err;
}

/* Full text of a thrown fetch error, cause included. For the log only. */
function errorText(err) {
  if (!err) return String(err);
  const cause = err.cause ? `; cause: ${err.cause.message || err.cause.code || err.cause}` : "";
  return `${err.name || "Error"}: ${err.message}${cause}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* One request of kind "list" or "model", at most 1 + retryMax attempts.
   Retries only after a network error, a timeout, HTTP 429 or 5xx. send(signal)
   performs the fetch. Returns { status, headers, body } with the parsed JSON
   body; otherwise throws with errorClass (network, timeout, http, parse) and
   httpStatus (null when there was no response). */
export async function request(kind, { method, url, body }, send) {
  if (!run || run.fd == null) throw new Error("request() before the run log is open");
  const timeoutMs = kind === "model" ? run.settings.modelTimeoutMs : run.settings.listTimeoutMs;
  const counts = run.calls[kind];
  for (let attempt = 1; ; attempt += 1) {
    logEvent(`${kind}-request`, { attempt, method, url, body });
    let err;
    try {
      const res = await send(AbortSignal.timeout(timeoutMs));
      const text = await res.text();
      let parsed;
      let isJson = true;
      try {
        parsed = JSON.parse(text);
      } catch {
        isJson = false;
      }
      logEvent(`${kind}-response`, { attempt, status: res.status, body: isJson ? parsed : text });
      if (res.ok && isJson) {
        counts.ok += 1;
        return { status: res.status, headers: res.headers, body: parsed };
      }
      err = res.ok
        ? requestError("parse", res.status, `${kind} response is not JSON`)
        : requestError("http", res.status, `${kind} HTTP ${res.status}`);
    } catch (thrown) {
      const timedOut = thrown && (thrown.name === "TimeoutError" || thrown.name === "AbortError");
      err = requestError(timedOut ? "timeout" : "network", null, errorText(thrown));
    }
    const retryable =
      err.errorClass === "network" ||
      err.errorClass === "timeout" ||
      (err.errorClass === "http" && (err.httpStatus === 429 || err.httpStatus >= 500));
    if (retryable && attempt <= run.settings.retryMax) {
      counts.retries += 1;
      logEvent("retry", { kind, attempt, class: err.errorClass, status: err.httpStatus, error: err.message });
      await sleep(run.settings.retryDelayMs);
      continue;
    }
    counts.failed += 1;
    logEvent("error", { kind, attempt, class: err.errorClass, status: err.httpStatus, error: err.message });
    throw err;
  }
}

/* Closes the log and returns { file, sha256 } for the receipt. Nothing is logged after this. */
export function closeRun() {
  logEvent("run-end", { calls: callCounts() });
  closeSync(run.fd);
  run.fd = null;
  const sha256 = createHash("sha256").update(readFileSync(join(runsDir, run.logFile))).digest("hex");
  return { file: run.logFile, sha256 };
}

/* runs/<runId>.json is created once and never overwritten; the latest copy is. Returns the file name. */
export function writeReceipt(artifact, latestName) {
  const body = JSON.stringify(artifact, null, 2);
  const file = `${run.runId}.json`;
  writeFileSync(join(runsDir, file), body, { flag: "wx" });
  writeFileSync(join(runsDir, latestName), body);
  return file;
}
