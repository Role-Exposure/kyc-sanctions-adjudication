/* /match client: the LIST, not the candidate.
   The list address comes from LIST_BASE_URL (no default): normally a local
   matching server loaded with the dated export described in snapshot.json.
   Auth header for the hosted API confirmed from https://www.opensanctions.org/docs/api/authentication/
   Authorization: ApiKey ${OPENSANCTIONS_API_KEY}, sent to the hosted API only.
   Dataset: the snapshot scope for --baseline and the model sit, and for
   --list-ping when snapshot.json is complete; otherwise OS_DATASET, else
   us_ofac_sdn (not "default"). */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "./runlog.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATASET = "us_ofac_sdn";
const BATCH_MAX = 100;
const VERSION_CHECKS = ["response", "description"];

function configError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

/* A list version that does not match snapshot.json, or a response without
   results for a query, stops the run as not completed, like every list request
   that fails. It must not reach the model as a tool result or turn into an
   invalid row. */
function listStop(errorClass, message, status) {
  const err = new Error(message);
  err.fatal = true;
  err.errorClass = errorClass;
  err.httpStatus = status;
  return err;
}

export function dataset() {
  const raw = (process.env.OS_DATASET || "").trim();
  return raw || DEFAULT_DATASET;
}

function listBase() {
  const raw = (process.env.LIST_BASE_URL || "").trim();
  let url = null;
  try {
    url = raw ? new URL(raw) : null;
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw configError("LIST_BASE_URL must be set to an http or https URL. Nothing sent.");
  }
  return url;
}

/* The only place the hosted API is named. The key is required and sent for this host only. */
function isHostedApi(base) {
  return base.hostname === "api.opensanctions.org";
}

function endpoint(base, ds) {
  return `${base.href.replace(/\/+$/, "")}/match/${ds}`;
}

/* Receipts carry the path only, never the address of the list server. */
export function endpointPath(ds) {
  return `/match/${ds}`;
}

function apiKey() {
  return (process.env.OPENSANCTIONS_API_KEY || "").trim();
}

function readSnapshot() {
  let bytes;
  try {
    bytes = readFileSync(join(here, "snapshot.json"));
  } catch {
    throw configError("snapshot.json cannot be read.");
  }
  let desc;
  try {
    desc = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw configError("snapshot.json is not valid JSON.");
  }
  if (!desc || typeof desc !== "object" || Array.isArray(desc)) {
    throw configError("snapshot.json must be a JSON object.");
  }
  return { desc, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function isEmpty(v) {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/* Empty and invalid fields of the snapshot description. server.params may be {}. */
function snapshotGaps(desc) {
  const server = desc.server && typeof desc.server === "object" ? desc.server : {};
  const scalars = {
    scope: desc.scope,
    exportDate: desc.exportDate,
    exportSha256: desc.exportSha256,
    exportFormat: desc.exportFormat,
    "server.software": server.software,
    "server.version": server.version,
    listVersion: desc.listVersion,
  };
  const empty = [];
  const invalid = [];
  if (desc.descriptionVersion !== 1) invalid.push("descriptionVersion (must be 1)");
  for (const [k, v] of Object.entries(scalars)) {
    if (isEmpty(v)) empty.push(k);
    else if (typeof v !== "string") invalid.push(`${k} (must be a string)`);
  }
  if (server.params == null) empty.push("server.params");
  else if (typeof server.params !== "object" || Array.isArray(server.params)) {
    invalid.push("server.params (must be an object)");
  }
  if (isEmpty(desc.versionCheck)) empty.push("versionCheck");
  else if (!VERSION_CHECKS.includes(desc.versionCheck)) {
    invalid.push('versionCheck (must be "response" or "description")');
  }
  return { empty, invalid };
}

/* One line for --check. No network. */
export function snapshotStatus() {
  try {
    const { empty, invalid } = snapshotGaps(readSnapshot().desc);
    if (!empty.length && !invalid.length) return "complete";
    const parts = [];
    if (empty.length) parts.push(`empty: ${empty.join(", ")}`);
    if (invalid.length) parts.push(`invalid: ${invalid.join(", ")}`);
    return `incomplete; ${parts.join("; ")}`;
  } catch (err) {
    return `unreadable; ${err.message}`;
  }
}

export function requireSnapshot() {
  const snapshot = readSnapshot();
  const { empty, invalid } = snapshotGaps(snapshot.desc);
  if (empty.length || invalid.length) {
    const parts = [];
    if (empty.length) parts.push(`empty: ${empty.join(", ")}`);
    if (invalid.length) parts.push(`invalid: ${invalid.join(", ")}`);
    throw configError(`snapshot.json is incomplete; ${parts.join("; ")}. Nothing sent.`);
  }
  return snapshot;
}

/* The description when it is complete, else null. --list-ping works without one. */
function completeSnapshot() {
  try {
    const snapshot = readSnapshot();
    const { empty, invalid } = snapshotGaps(snapshot.desc);
    return empty.length || invalid.length ? null : snapshot;
  } catch {
    return null;
  }
}

/* All list checks, before any network. With useSnapshot (--baseline and the
   model sit) the description must be complete, the dataset is its scope and
   every response is checked against its listVersion. --list-ping uses the
   scope when the description is complete, else OS_DATASET or the default; it
   gets no snapshot, so it prints the served version and checks it only
   against pingExpectedVersion(). */
export function listSetup({ useSnapshot = false } = {}) {
  const base = listBase();
  if (isHostedApi(base) && !apiKey()) {
    throw configError("OPENSANCTIONS_API_KEY is missing (required by the hosted API only). Nothing sent.");
  }
  const snapshot = useSnapshot ? requireSnapshot() : completeSnapshot();
  if (!snapshot) return { base, dataset: dataset(), snapshot: null };
  const envDs = (process.env.OS_DATASET || "").trim();
  if (envDs && envDs !== snapshot.desc.scope) {
    throw configError(`OS_DATASET "${envDs}" differs from snapshot.json scope "${snapshot.desc.scope}". Nothing sent.`);
  }
  return { base, dataset: snapshot.desc.scope, snapshot: useSnapshot ? snapshot : null };
}

/* listVersion that --list-ping must match: only when snapshot.json sets it and
   versionCheck is "response". Read before the ping; an unreadable file means no check. */
export function pingExpectedVersion() {
  try {
    const { desc } = readSnapshot();
    if (desc.versionCheck === "response" && !isEmpty(desc.listVersion)) return String(desc.listVersion);
  } catch {
    return null;
  }
  return null;
}

/* Snapshot block of both receipts: the description as written, with its digest. */
export function snapshotBlock(snapshot) {
  const d = snapshot.desc;
  return {
    descriptionVersion: d.descriptionVersion,
    scope: d.scope,
    exportDate: d.exportDate,
    exportSha256: d.exportSha256,
    exportFormat: d.exportFormat,
    server: d.server,
    listVersion: d.listVersion,
    versionCheck: d.versionCheck,
    descriptionSha256: snapshot.sha256,
  };
}

export function partyToQuery(party) {
  const type = party && party.type;
  if (type === "person") {
    const properties = { name: [String(party.name || "")] };
    if (party.dob) properties.birthDate = [String(party.dob)];
    if (party.country) {
      properties.nationality = [String(party.country)];
      properties.country = [String(party.country)];
    }
    if (party.passport) properties.passportNumber = [String(party.passport)];
    return { schema: "Person", properties };
  }
  const properties = { name: [String(party && party.name ? party.name : "")] };
  if (party && party.country) properties.country = [String(party.country)];
  return { schema: "Company", properties };
}

function slimCandidate(row) {
  return {
    id: row && row.id != null ? row.id : null,
    caption: row && row.caption != null ? row.caption : null,
    score: row && row.score != null ? row.score : null,
    schema: row && row.schema != null ? row.schema : null,
    datasets: row && row.datasets != null ? row.datasets : null,
  };
}

/* Dataset version served with a response, or null. etag and last-modified are
   not read: they describe the response, not the dataset. */
function vintageFrom(res, body) {
  const headerKeys = [
    "x-dataset-version",
    "x-opensanctions-version",
    "x-dataset-export",
  ];
  for (const k of headerKeys) {
    const v = res.headers.get(k);
    if (v) return v;
  }
  const bodyKeys = [
    body && body.last_export,
    body && body.lastExport,
    body && body.vintage,
    body && body.version,
    body && body.index && body.index.last_export,
    body && body.index && body.index.version,
    body && body.dataset && body.dataset.last_export,
    body && body.dataset && body.dataset.version,
  ];
  for (const v of bodyKeys) {
    if (v != null && v !== "") return String(v);
  }
  return null;
}

/* versionCheck "response": every response must carry listVersion.
   versionCheck "description": the server serves no version; one that differs still stops. */
function checkVersion(served, desc, status) {
  const expected = String(desc.listVersion);
  if (desc.versionCheck === "response" && served == null) {
    throw listStop("version", `List response carries no version; snapshot.json listVersion is "${expected}".`, status);
  }
  if (served != null && served !== expected) {
    throw listStop("version", `List version mismatch: served "${served}", snapshot.json listVersion "${expected}".`, status);
  }
}

export async function matchParties(parties, state = listSetup()) {
  const list = Array.isArray(parties) ? parties : [parties];
  const ds = state.dataset;
  const url = endpoint(state.base, ds);
  const expect = state.snapshot ? state.snapshot.desc : null;
  const matches = [];
  let served = null;
  let status = null;

  for (let i = 0; i < list.length; i += BATCH_MAX) {
    const chunk = list.slice(i, i + BATCH_MAX);
    const queries = {};
    for (const p of chunk) queries[p.id] = partyToQuery(p);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (isHostedApi(state.base)) headers.Authorization = `ApiKey ${apiKey()}`;
    const payload = { queries };
    let res;
    try {
      res = await request("list", { method: "POST", url, body: payload }, (signal) =>
        fetch(url, { method: "POST", headers, body: JSON.stringify(payload), redirect: "error", signal }),
      );
    } catch (err) {
      if (err && err.errorClass) err.fatal = true;
      throw err;
    }
    const body = res.body;
    status = res.status;
    const v = vintageFrom(res, body);
    if (expect) checkVersion(v, expect, res.status);
    if (served == null) served = v;
    const responses = body && typeof body === "object" ? body.responses : null;
    for (const p of chunk) {
      const block = responses && typeof responses === "object" ? responses[p.id] : null;
      // A response without results for a query is not "no candidates": it stops the run.
      if (!block || typeof block !== "object" || !Array.isArray(block.results)) {
        throw listStop("parse", `List response has no results array for query "${p.id}".`, res.status);
      }
      const results = block.results.map(slimCandidate);
      matches.push({ id: p.id, results, top: results[0] || null });
    }
  }

  return { dataset: ds, served, vintage: expect ? String(expect.listVersion) : served, status, matches };
}

/* One party. The model decides when to call this; the runner does not pre-screen. */
export async function matchList(party, state = listSetup()) {
  const out = await matchParties([party], state);
  const row = out.matches[0];
  return {
    dataset: out.dataset,
    served: out.served,
    vintage: out.vintage,
    status: out.status,
    candidates: row ? row.results : [],
  };
}

/* One invented probe, not a book party: --list-ping, and the probe before the
   first row of --baseline and --model. */
export async function listPing(state = listSetup()) {
  return matchList({ id: "ping", type: "person", name: "List Ping Probe" }, state);
}
