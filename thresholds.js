/* thresholds.json: every number that moves the outcome, in one file covered
   by SHA256SUMS. This module reads and checks it and never fills a value in:
   a cell left null is reported, not defaulted. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/* The objects of the file and the keys each may hold; any other key is an error. */
const SHAPE = {
  "": ["thresholdsVersion", "rubric", "repeats", "intervals", "perEntity", "baseline"],
  rubric: ["holdMax", "worksHoldMax", "hitPrecisionMin", "invalid"],
  "rubric.invalid": ["maxRows", "withinTolerance"],
  repeats: ["n", "aggregation"],
  intervals: ["method", "level", "metrics"],
  baseline: ["hitMin", "holdMin", "thinHoldFloor"],
};

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isShare = (v) => typeof v === "number" && v >= 0 && v <= 1;
const oneOf = (...allowed) => (v) => allowed.includes(v);

/* The 14 cells, in file order, each with its check. Closed sets hold one value each. */
const CELLS = {
  "rubric.holdMax": isCount,
  "rubric.worksHoldMax": isCount,
  "rubric.hitPrecisionMin": isShare,
  "rubric.invalid.maxRows": isCount,
  "rubric.invalid.withinTolerance": oneOf("hold"),
  "repeats.n": (v) => Number.isInteger(v) && v >= 1,
  "repeats.aggregation": oneOf("worst-pass"),
  "intervals.method": oneOf("clopper-pearson-upper"),
  "intervals.level": (v) => typeof v === "number" && v > 0 && v < 1,
  "intervals.metrics": (v) =>
    Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every(oneOf("missedRate")),
  perEntity: (v) => typeof v === "boolean",
  "baseline.hitMin": isShare,
  "baseline.holdMin": isShare,
  "baseline.thinHoldFloor": isShare,
};

/* Pairs the gates and the baseline ladder rely on, [lower, higher]. Out of order, both cells are errors. */
const ORDER = [
  ["rubric.worksHoldMax", "rubric.holdMax"],
  ["baseline.thinHoldFloor", "baseline.holdMin"],
  ["baseline.holdMin", "baseline.hitMin"],
];

function at(obj, path) {
  return path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

/* Parsed values, empty and invalid cells (full keys, file order) and the SHA-256 of the file bytes. */
export function loadThresholds() {
  let bytes;
  try {
    bytes = readFileSync(join(here, "thresholds.json"));
  } catch {
    return { values: null, empty: [], invalid: ["thresholds.json"], sha256: null };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let values;
  try {
    values = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { values: null, empty: [], invalid: ["thresholds.json"], sha256 };
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return { values: null, empty: [], invalid: ["thresholds.json"], sha256 };
  }

  const invalid = new Set();
  for (const [path, keys] of Object.entries(SHAPE)) {
    const obj = path ? at(values, path) : values;
    if (obj === undefined || obj === null) continue;
    if (typeof obj !== "object" || Array.isArray(obj)) {
      invalid.add(path);
      continue;
    }
    for (const k of Object.keys(obj)) if (!keys.includes(k)) invalid.add(path ? `${path}.${k}` : k);
  }
  if (values.thresholdsVersion !== 1) invalid.add("thresholdsVersion");

  const empty = [];
  for (const [cell, check] of Object.entries(CELLS)) {
    const v = at(values, cell);
    if (v === null || v === undefined) empty.push(cell);
    else if (!check(v)) invalid.add(cell);
  }
  for (const [lo, hi] of ORDER) {
    const a = at(values, lo);
    const b = at(values, hi);
    if (CELLS[lo](a) && CELLS[hi](b) && a > b) {
      invalid.add(lo);
      invalid.add(hi);
    }
  }

  const order = Object.keys(CELLS);
  const rank = (k) => (order.includes(k) ? order.indexOf(k) : order.length);
  return { values, empty, invalid: [...invalid].sort((a, b) => rank(a) - rank(b)), sha256 };
}

/* The refusal for --baseline, --model and --rubric-test, or null when every cell is set and valid. */
export function thresholdsProblem(t) {
  const parts = [];
  if (t.empty.length) parts.push(`empty: ${t.empty.join(", ")}`);
  if (t.invalid.length) parts.push(`invalid: ${t.invalid.join(", ")}`);
  return parts.length ? `thresholds.json: ${parts.join("; ")}` : null;
}

/* One line for --check. */
export function thresholdsStatus(t) {
  if (t.invalid.length) return `invalid keys=${t.invalid.join(",")}`;
  if (t.empty.length) return `incomplete empty=${t.empty.join(",")}`;
  return `complete sha256=${t.sha256}`;
}

/* What the rubric reads. */
export function rubricRules(values) {
  return { rubric: values.rubric, intervals: values.intervals, perEntity: values.perEntity };
}
