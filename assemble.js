/* Row assembly. A book row derived from a listed entity carries only the
   entity id and a variant recipe; this module builds the visible party from
   the dated list export at run time. Other rows are literals and pass as they
   are. The export path comes from LIST_EXPORT_PATH and is never printed or
   recorded. Same export and same book give the same bytes. */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { visibleParty } from "./candidate.js";

/* The one export format the kit reads: one FtM entity as JSON per line. */
export const EXPORT_FORMAT = "application/json+ftm";

function configError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function assemblyError(code, row) {
  const err = new Error(`assembly stopped at ${row}: ${code}`);
  err.errorClass = "assembly";
  err.code = code;
  err.row = row;
  return err;
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/* Counts for --check, from the book alone. */
export function bookCounts(parties) {
  const derived = parties.filter((p) => p.entity);
  return {
    entity: derived.length,
    literal: parties.length - derived.length,
    entities: new Set(derived.map((p) => p.entity)).size,
  };
}

/* Refusals before any network call and before runs/ (exit 2). The messages never name the path. */
export async function checkExport(snapshot) {
  const path = (process.env.LIST_EXPORT_PATH || "").trim();
  if (!path) throw configError("LIST_EXPORT_PATH must name the entities file of the export. Nothing sent.");
  if (snapshot.desc.exportFormat !== EXPORT_FORMAT) {
    throw configError(`snapshot.json exportFormat must be "${EXPORT_FORMAT}". Nothing sent.`);
  }
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk);
  } catch {
    throw configError("LIST_EXPORT_PATH: cannot be read. Nothing sent.");
  }
  if (hash.digest("hex") !== snapshot.desc.exportSha256) {
    throw configError("LIST_EXPORT_PATH: digest does not match exportSha256. Nothing sent.");
  }
  return path;
}

/* Objects whose id is in `ids`, each id with every object that has it. Reads the file as a stream. */
async function readObjects(path, ids) {
  const found = new Map([...ids].map((id) => [id, []]));
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      let hit = false;
      for (const id of ids) {
        if (line.includes(id)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj && typeof obj.id === "string" && found.has(obj.id)) found.get(obj.id).push(obj);
    }
  } catch {
    throw new Error("LIST_EXPORT_PATH: cannot be read.");
  }
  return found;
}

function values(entity, prop) {
  const v = entity.properties && entity.properties[prop];
  return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string"))] : [];
}

/* Exactly one distinct value, or the code that says why not. */
function single(entity, prop) {
  const v = values(entity, prop);
  if (v.length === 0) return { code: "missing-property" };
  if (v.length > 1) return { code: "ambiguous" };
  return { value: v[0] };
}

const fold = (s) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function byCodePoint(a, b) {
  const x = [...a].map((c) => c.codePointAt(0));
  const y = [...b].map((c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

function nameSource(row, entity, spec) {
  if (spec.from === "caption") {
    return typeof entity.caption === "string" && entity.caption ? { value: entity.caption } : { code: "missing-property" };
  }
  if (spec.from === "name-diacritic") {
    if (typeof entity.caption !== "string") return { code: "missing-property" };
    const v = values(entity, "name").filter((n) => n !== entity.caption && fold(n) === fold(entity.caption));
    if (v.length === 0) return { code: "missing-property" };
    if (v.length > 1) return { code: "ambiguous" };
    return { value: v[0] };
  }
  if (spec.from === "weakAlias") {
    const v = values(entity, "weakAlias").sort(byCodePoint);
    if (v.length === 0) return { code: "missing-property" };
    const i = spec.index === undefined ? 0 : spec.index;
    if (!Number.isInteger(i) || i < 0 || i >= v.length) return { code: "index" };
    return { value: v[i] };
  }
  if (spec.from === "lastName") return single(entity, "lastName");
  if (spec.from === "literal") {
    return typeof row.name === "string" && row.name ? { value: row.name } : { code: "missing-property" };
  }
  return { code: "op" };
}

const isIndex = (i, n) => Number.isInteger(i) && i >= 0 && i < n;
const titleToken = (t) => t.slice(0, 1).toUpperCase() + t.slice(1).toLowerCase();

/* One operation on the name. Returns { value } or { code }. */
function applyOp(name, op) {
  if (!Array.isArray(op) || typeof op[0] !== "string") return { code: "op" };
  const tokens = name.split(" ");
  const [kind, a, b, c] = op;
  switch (kind) {
    case "upper":
      return { value: name.toUpperCase() };
    case "title": {
      const keep = a === undefined ? [] : a;
      if (!Array.isArray(keep)) return { code: "op" };
      if (!keep.every((k) => isIndex(k, tokens.length))) return { code: "index" };
      return { value: tokens.map((t, i) => (keep.includes(i) ? t : titleToken(t))).join(" ") };
    }
    case "keep": {
      if (!Array.isArray(a) || a.length === 0) return { code: "op" };
      if (!a.every((i) => isIndex(i, tokens.length)) || new Set(a).size !== a.length) return { code: "index" };
      return { value: a.map((i) => tokens[i]).join(" ") };
    }
    case "surname-first":
      if (tokens.length < 2) return { code: "op" };
      return { value: `${tokens.slice(1).map((t) => t.toUpperCase()).join(" ")}, ${tokens[0]}` };
    case "initial":
      if (!isIndex(a, tokens.length)) return { code: "index" };
      if (tokens[a].length <= 1) return { code: "op" };
      tokens[a] = `${tokens[a].slice(0, 1)}.`;
      return { value: tokens.join(" ") };
    case "typo":
      if (!isIndex(a, tokens.length) || !isIndex(b, tokens[a].length)) return { code: "index" };
      if (typeof c !== "string" || c.length !== 1 || tokens[a][b] === c) return { code: "op" };
      tokens[a] = tokens[a].slice(0, b) + c + tokens[a].slice(b + 1);
      return { value: tokens.join(" ") };
    case "legal-ltd":
      if (tokens[tokens.length - 1].toLowerCase() !== "limited") return { code: "op" };
      tokens[tokens.length - 1] = "Ltd";
      return { value: tokens.join(" ") };
    case "suffix":
      if (typeof a !== "string" || !a) return { code: "op" };
      return { value: `${name} ${a}` };
    case "insert":
      if (!Number.isInteger(a) || a <= 0 || a > tokens.length) return { code: "index" };
      if (typeof b !== "string" || !b) return { code: "op" };
      tokens.splice(a, 0, b);
      return { value: tokens.join(" ") };
    default:
      return { code: "op" };
  }
}

function validDate(y, m, d) {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

function birthDate(entity, spec) {
  const one = single(entity, "birthDate");
  if (one.code) return one;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(one.value);
  if (!m) return { code: "date" };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (spec === "card") return validDate(y, mo, d) ? { value: one.value } : { code: "date" };
  const n = spec && typeof spec === "object" ? spec.yearShift : undefined;
  if (!Number.isInteger(n) || n === 0 || !validDate(y + n, mo, d)) return { code: "date" };
  return { value: `${String(y + n).padStart(4, "0")}-${m[2]}-${m[3]}` };
}

/* The visible party of one derived row, or the first code that stops it. */
function assembleRow(row, entity, addresses) {
  const r = row.recipe;
  if (!r || typeof r !== "object" || !r.name || typeof r.name !== "object") return { code: "op" };
  if (entity.schema !== r.schema) return { code: "schema" };
  if (row.ofac != null) {
    const refs = Array.isArray(entity.referents) ? entity.referents : [];
    if (!refs.includes(`ofac-${row.ofac}`)) return { code: "ofac" };
  }

  let name = nameSource(row, entity, r.name);
  if (name.code) return name;
  for (const op of r.name.ops || []) {
    name = applyOp(name.value, op);
    if (name.code) return name;
  }

  const out = { id: row.id, type: row.type, name: name.value };
  if (r.dob !== undefined) {
    const dob = birthDate(entity, r.dob);
    if (dob.code) return dob;
    out.dob = dob.value;
  }
  if ((r.country !== undefined) !== Boolean(row.country)) return { code: "country" };
  if (r.country !== undefined) {
    const codes = new Set(["nationality", "citizenship", "country"].flatMap((p) => values(entity, p)).map((v) => v.toLowerCase()));
    const listed = codes.has(String(row.country).toLowerCase());
    if (r.country === "card" ? !listed : r.country === "other" ? listed : true) return { code: "country" };
    out.country = row.country;
  }
  if (r.city !== undefined) {
    if (r.city !== "card") return { code: "op" };
    const ref = single(entity, "addressEntity");
    if (ref.code) return ref;
    const found = addresses.get(ref.value) || [];
    if (found.length === 0) return { code: "missing-entity" };
    if (found.length > 1) return { code: "duplicate-entity" };
    if (found[0].schema !== "Address") return { code: "schema" };
    const city = single(found[0], "city");
    if (city.code) return city;
    out.city = city.value;
  }
  if (r.passport !== undefined) {
    if (r.passport !== "card") return { code: "op" };
    const passport = single(entity, "passportNumber");
    if (passport.code) return passport;
    out.passport = passport.value;
  }
  return { party: out };
}

/* Assembles every row in book order. Throws an assembly error (row and code)
   at the first row that fails. Returns the rows with their digests and the
   assembly digest. */
export async function assembleBook(parties, path) {
  const entityIds = new Set(parties.filter((p) => p.entity).map((p) => p.entity));
  const entities = await readObjects(path, entityIds);

  const addressIds = new Set();
  for (const p of parties) {
    if (!p.entity || !p.recipe || p.recipe.city === undefined) continue;
    const found = entities.get(p.entity);
    if (found.length === 1) for (const id of values(found[0], "addressEntity")) addressIds.add(id);
  }
  const addresses = addressIds.size ? await readObjects(path, addressIds) : new Map();

  const rows = [];
  for (const p of parties) {
    let party;
    if (p.entity) {
      const found = entities.get(p.entity);
      if (found.length === 0) throw assemblyError("missing-entity", p.id);
      if (found.length > 1) throw assemblyError("duplicate-entity", p.id);
      const res = assembleRow(p, found[0], addresses);
      if (res.code) throw assemblyError(res.code, p.id);
      party = res.party;
    } else {
      party = p;
    }
    const inputSha256 = sha256(JSON.stringify(visibleParty(party)));
    rows.push(
      p.entity
        ? { id: p.id, source: "entity", entity: p.entity, recipe: p.recipe, party: visibleParty(party), inputSha256 }
        : { id: p.id, source: "literal", party: visibleParty(party), inputSha256 },
    );
  }
  const assemblySha256 = sha256(rows.map((r) => `${r.id} ${r.inputSha256}\n`).join(""));
  return { rows, assemblySha256 };
}
