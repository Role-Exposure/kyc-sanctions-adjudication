/* Deterministic OFAC-style fuzzy baseline: not a model, not OpenSanctions-as-judge.
   Same list tool as the candidate (list.js /match). Adjudication is local rules:
   normalize → Jaro-Winkler + Levenshtein + token-set → published thresholds → hit|hold|clear.
   Law 06: this instrument is not drawn from the candidate model family. */

import { matchList } from "./list.js";
import { visibleParty } from "./candidate.js";

export const BASELINE_ID = "baseline.ofac-style-fuzzy.v1";

/** Thresholds hitMin, holdMin and thinHoldFloor are declared in the baseline
    block of thresholds.json and passed in; changing one changes the digest of
    that file, which every receipt records. Below holdMin → clear when the party
    is not thin. */

export const TOOLS_ALLOWED = ["opensanctions.match"];

function fold(s) {
  let out = String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  out = out
    .replace(/\blimited\b/g, "ltd")
    .replace(/\bincorporated\b/g, "inc")
    .replace(/\bcorporation\b/g, "corp")
    .replace(/\bcompany\b/g, "co")
    .replace(/\bs a de c v\b/g, "sadecv");
  return out.replace(/\s+/g, " ").trim();
}

function tokens(s) {
  const t = fold(s);
  return t ? t.split(" ") : [];
}

function levenshtein(a, b) {
  const s = fold(a);
  const t = fold(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const rows = s.length + 1;
  const cols = t.length + 1;
  let prev = new Array(cols);
  let cur = new Array(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[t.length];
}

function levRatio(a, b) {
  const s = fold(a);
  const t = fold(b);
  const n = Math.max(s.length, t.length);
  if (!n) return 1;
  return 1 - levenshtein(s, t) / n;
}

/** Jaro similarity. */
function jaro(a, b) {
  const s1 = fold(a);
  const s2 = fold(b);
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;
  const matchDist = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1m = new Array(s1.length).fill(false);
  const s2m = new Array(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = true;
      s2m[j] = true;
      matches += 1;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k += 1;
    if (s1[i] !== s2[k]) t += 1;
    k += 1;
  }
  const m = matches;
  return (m / s1.length + m / s2.length + (m - t / 2) / m) / 3;
}

/** Jaro-Winkler with prefix bonus (classic Winkler, p=0.1, L<=4). */
export function jaroWinkler(a, b) {
  const j = jaro(a, b);
  if (j === 0) return 0;
  const s1 = fold(a);
  const s2 = fold(b);
  let l = 0;
  const lim = Math.min(4, s1.length, s2.length);
  while (l < lim && s1[l] === s2[l]) l += 1;
  return j + l * 0.1 * (1 - j);
}

/** Token-set ratio: Jaccard on unique tokens, blended with JW of sorted token strings. */
export function tokenSetRatio(a, b) {
  const ta = [...new Set(tokens(a))];
  const tb = [...new Set(tokens(b))];
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  const jacc = union === 0 ? 0 : inter / union;
  const sortedA = [...sa].sort().join(" ");
  const sortedB = [...sb].sort().join(" ");
  const jw = jaroWinkler(sortedA, sortedB);
  return 0.5 * jacc + 0.5 * jw;
}

export function nameScore(queryName, candidateCaption) {
  const jw = jaroWinkler(queryName, candidateCaption);
  const lev = levRatio(queryName, candidateCaption);
  const ts = tokenSetRatio(queryName, candidateCaption);
  const score = Math.max(jw, lev, ts);
  return { score, jw, lev, tokenSet: ts };
}

function schemaCompatible(party, top) {
  if (!top || !top.schema) return true;
  const sch = String(top.schema).toLowerCase();
  if (party.type === "person") {
    if (sch.includes("company") || sch.includes("organization") || sch.includes("legalentity")) return false;
  }
  if (party.type === "company") {
    if (sch.includes("person") || sch === "individual") return false;
  }
  return true;
}

function isThinParty(party) {
  const toks = tokens(party.name);
  if (toks.length <= 1) return true;
  if (party.type === "person" && !(party.dob && String(party.dob).trim())) return true;
  return false;
}

/**
 * The candidate the baseline judges: the highest server score; among equal
 * scores (===) the smallest id by UTF-16 code units, without a locale, and a
 * candidate whose id is not a string after those whose id is. A candidate
 * without a numeric score takes no part; when none has one, the first the
 * server returned. So the order in which the server lists equal candidates
 * does not change the choice.
 */
export function bestCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const scored = list.filter((c) => c && typeof c.score === "number");
  if (!scored.length) return list[0] || null;
  const best = Math.max(...scored.map((c) => c.score));
  let pick = null;
  for (const c of scored) {
    if (c.score !== best) continue;
    if (!pick) pick = c;
    else if (typeof c.id === "string" && (typeof pick.id !== "string" || c.id < pick.id)) pick = c;
  }
  return pick;
}

/**
 * Adjudicate one party from list candidates. Pure. No gold. No network.
 * `thresholds` is the baseline block of thresholds.json.
 */
export function adjudicateFromMatch(party, candidates, thresholds) {
  const list = Array.isArray(candidates) ? candidates : [];
  const top = bestCandidate(list);
  const caption = top && top.caption != null ? String(top.caption) : "";
  const listScore = top && typeof top.score === "number" ? top.score : null;
  const fuzzy = caption ? nameScore(party.name, caption) : { score: 0, jw: 0, lev: 0, tokenSet: 0 };
  /** Prefer local fuzzy vs caption; fall back to vendor score if no caption. */
  const score = caption ? fuzzy.score : listScore != null ? listScore : 0;
  const thin = isThinParty(party);
  const compatible = schemaCompatible(party, top);

  /* reason is a code for the branch taken; the numbers are already in score and fuzzy. */
  let decision = "clear";
  let reason;

  if (!top || score < thresholds.thinHoldFloor) {
    decision = thin ? "hold" : "clear";
    reason = thin ? "thin-weak-hold" : "weak-clear";
  } else if (!compatible) {
    decision = score >= thresholds.holdMin ? "hold" : "clear";
    reason = "schema-mismatch";
  } else if (score >= thresholds.hitMin && !thin) {
    decision = "hit";
    reason = "score-hit";
  } else if (score >= thresholds.holdMin || (thin && score >= thresholds.thinHoldFloor)) {
    decision = "hold";
    reason = thin ? "thin-elevated-hold" : "score-hold";
  } else {
    decision = "clear";
    reason = "score-clear";
  }

  const out = {
    id: party.id,
    decision,
    reason,
    matchCalls: 1,
    score,
    fuzzy,
  };
  if (top) {
    // Id, score and schema only: the name on the list card stays in memory and in the local log.
    out.topMatch = {
      id: top.id ?? null,
      score: top.score ?? null,
      schema: top.schema ?? null,
    };
  }
  return out;
}

export async function adjudicateParty(party, listState, thresholds) {
  const match = await matchList(party, listState);
  const row = adjudicateFromMatch(party, match.candidates || [], thresholds);
  row.matchCalls = 1;
  return row;
}

export function baselineMeta() {
  return {
    id: BASELINE_ID,
    kind: "deterministic-fuzzy",
    family: "ofac-style-rules",
    notModel: true,
    methods: ["normalize", "jaro-winkler", "levenshtein-ratio", "token-set"],
    listTool: "opensanctions.match",
    note: "OpenSanctions is the list vendor only. This baseline adjudicates; it is not an independent reviewer.",
  };
}

export { visibleParty };
