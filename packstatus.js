/* pack-status.json: whether the book is SAMPLE, how it was reviewed and who
   accepted it, pinned to the SHA-256 of the accepted data.js. A book changed
   after its acceptance is not accepted. This module reads and checks the file;
   it never fills a value in. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const KEYS = ["statusVersion", "sample", "review", "accepted"];
const ACCEPTED_KEYS = ["by", "date", "bookSha256"];

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/* Parsed values, empty and invalid keys, the SHA-256 of the file bytes and
   whether the acceptance names the bytes of data.js as they are now. */
export function loadPackStatus() {
  const bookSha256 = sha256(readFileSync(join(here, "data.js")));
  let bytes;
  try {
    bytes = readFileSync(join(here, "pack-status.json"));
  } catch {
    return { values: null, empty: [], invalid: ["pack-status.json"], sha256: null, bookMatch: false };
  }
  const statusSha256 = sha256(bytes);
  let v;
  try {
    v = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { values: null, empty: [], invalid: ["pack-status.json"], sha256: statusSha256, bookMatch: false };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { values: null, empty: [], invalid: ["pack-status.json"], sha256: statusSha256, bookMatch: false };
  }

  const invalid = [];
  for (const k of Object.keys(v)) if (!KEYS.includes(k)) invalid.push(k);
  if (v.statusVersion !== 1) invalid.push("statusVersion");
  if (typeof v.sample !== "boolean") invalid.push("sample");
  if (v.review !== "internal" && v.review !== "independent") invalid.push("review");
  const a = v.accepted;
  const empty = [];
  if (!a || typeof a !== "object" || Array.isArray(a)) {
    invalid.push("accepted");
  } else {
    for (const k of Object.keys(a)) if (!ACCEPTED_KEYS.includes(k)) invalid.push(`accepted.${k}`);
    if (typeof a.by !== "string" || !a.by.trim()) invalid.push("accepted.by");
    if (a.date != null && (typeof a.date !== "string" || !validDate(a.date))) invalid.push("accepted.date");
    if (a.bookSha256 != null && (typeof a.bookSha256 !== "string" || !/^[0-9a-f]{64}$/.test(a.bookSha256))) {
      invalid.push("accepted.bookSha256");
    }
    // The date and the book digest are given together or not at all.
    if ((a.date == null) !== (a.bookSha256 == null)) invalid.push("accepted");
    if (a.date == null) empty.push("accepted.date");
    if (a.bookSha256 == null) empty.push("accepted.bookSha256");
  }
  const bookMatch = Boolean(a && typeof a === "object" && a.bookSha256 === bookSha256);
  return { values: v, empty, invalid, sha256: statusSha256, bookMatch };
}

/* The refusal for --baseline and --model, or null: the file must be valid,
   the acceptance given, and its digest must be that of data.js now. */
export function packStatusProblem(s) {
  if (s.invalid.length) return `pack-status.json: invalid: ${s.invalid.join(", ")}`;
  if (s.empty.length) return `pack-status.json: empty: ${s.empty.join(", ")}`;
  if (!s.bookMatch) return "pack-status.json: accepted.bookSha256 does not match data.js";
  return null;
}

/* One line for --check. */
export function packStatusLine(s) {
  if (s.invalid.length) return `invalid keys=${s.invalid.join(",")}`;
  const v = s.values;
  const accepted = v.accepted.date == null ? "accepted=none" : `accepted=${v.accepted.date} book=${s.bookMatch ? "match" : "mismatch"}`;
  return `sample=${v.sample} review=${v.review} ${accepted} sha256=${s.sha256}`;
}

/* The banner of the pack, built from the file alone. An acceptance whose digest
   is not that of data.js now does not count. */
export function bannerOf(s) {
  const v = s.values;
  const parts = [];
  if (v.sample) parts.push("SAMPLE");
  parts.push(v.accepted.date != null && s.bookMatch ? `accepted ${v.accepted.date}` : "not accepted");
  parts.push(`${v.review} review`, "not HOLDOUT");
  return parts.join(" · ");
}

/* The receipt block: each value with the digest of the file it comes from. */
export function packStatusBlock(s) {
  const v = s.values;
  return {
    statusSha256: s.sha256,
    sample: v.sample,
    review: v.review,
    accepted: { by: v.accepted.by, date: v.accepted.date, bookSha256: v.accepted.bookSha256 },
  };
}
