/* Named-model client. The candidate is the model the USER names.
   One allowed tool: match_list → list.js (OpenSanctions /match).
   Empty CANDIDATE_MODEL refuses. No default model id. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchList } from "./list.js";
import { logEvent, request } from "./runlog.js";

export const TOOLS_ALLOWED = ["opensanctions.match"];

const ALLOWED = new Set(["hit", "hold", "clear"]);
const STYLES = ["openai", "anthropic"];
const THINKING = ["disabled", "adaptive"];
const PING_MESSAGE = "Reply with the single word: ok";

/* The system prompt is read as is, without trimming. */
const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_BYTES = readFileSync(join(here, "system-prompt.txt"));
const SYSTEM = SYSTEM_BYTES.toString("utf8");
export const SYSTEM_PROMPT_SHA256 = createHash("sha256").update(SYSTEM_BYTES).digest("hex");

/* responseSha256: the SHA-256 of the text the decision is parsed from, before
   any trimming; null without text. The text is the "text" blocks of the last
   response joined (style anthropic) or its message content (style openai),
   as the raw response in the local log holds them. */
export function responseSha256(text) {
  return typeof text === "string" && text !== "" ? createHash("sha256").update(text, "utf8").digest("hex") : null;
}

/* Every model id any response named during this process. */
const seenModelIds = new Set();
export function returnedModelIds() {
  return [...seenModelIds];
}

export function visibleParty(p) {
  const out = { id: p.id, type: p.type, name: p.name };
  if (p.dob != null && p.dob !== "") out.dob = p.dob;
  if (p.country != null && p.country !== "") out.country = p.country;
  if (p.city != null && p.city !== "") out.city = p.city;
  if (p.passport != null && p.passport !== "") out.passport = p.passport;
  return out;
}

/* No defaults: an unset temperature or token limit is not sent at all. */
export function candidateConfig() {
  const name = (process.env.CANDIDATE_MODEL || "").trim();
  const baseUrl = (process.env.CANDIDATE_BASE_URL || "").trim().replace(/\/$/, "");
  const apiKey = (process.env.CANDIDATE_API_KEY || "").trim();
  const style = (process.env.CANDIDATE_API_STYLE || "").trim();
  const rawTemp = (process.env.CANDIDATE_TEMPERATURE || "").trim();
  const temperature = rawTemp === "" ? null : /^-?\d+(\.\d+)?$/.test(rawTemp) ? Number(rawTemp) : NaN;
  const rawMax = (process.env.CANDIDATE_MAX_TOKENS || "").trim();
  const maxTokens = rawMax === "" ? null : /^\d+$/.test(rawMax) ? Number(rawMax) : NaN;
  const thinking = (process.env.CANDIDATE_THINKING || "").trim();
  // Named in the receipt instead of an address.
  const provider = (process.env.CANDIDATE_PROVIDER || "").trim() || style;
  return { name, baseUrl, apiKey, style, temperature, maxTokens, thinking, provider };
}

function configError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

export function requireCandidate() {
  const cfg = candidateConfig();
  if (!cfg.name) throw configError("CANDIDATE_MODEL is empty. Name the model first.");
  if (!STYLES.includes(cfg.style)) {
    throw configError('CANDIDATE_API_STYLE must be "openai" or "anthropic". Nothing sent.');
  }
  const missing = [];
  if (!cfg.baseUrl) missing.push("CANDIDATE_BASE_URL");
  if (!cfg.apiKey) missing.push("CANDIDATE_API_KEY");
  if (missing.length) throw configError(`${missing.join(" and ")} required.`);
  if (Number.isNaN(cfg.temperature)) throw configError("CANDIDATE_TEMPERATURE must be a number. Nothing sent.");
  if (Number.isNaN(cfg.maxTokens) || cfg.maxTokens === 0) {
    throw configError("CANDIDATE_MAX_TOKENS must be a whole number above 0. Nothing sent.");
  }
  if (cfg.style === "anthropic" && cfg.maxTokens == null) {
    throw configError("CANDIDATE_MAX_TOKENS is required for the anthropic API style. Nothing sent.");
  }
  // No default: the choice is declared, not inherited from the provider.
  if (cfg.style === "anthropic" && !THINKING.includes(cfg.thinking)) {
    throw configError('CANDIDATE_THINKING must be "disabled" or "adaptive" for the anthropic API style. Nothing sent.');
  }
  if (cfg.style === "openai" && cfg.thinking !== "") {
    throw configError("CANDIDATE_THINKING must be empty for the openai API style. Nothing sent.");
  }
  return cfg;
}

/* The parameters a request body carries besides model, messages, tools and system: only those that are set.
   Thinking "adaptive" sends no field: adaptive thinking is the provider's own behaviour. */
export function modelParams(cfg) {
  const params = {};
  if (cfg.temperature != null) params.temperature = cfg.temperature;
  if (cfg.maxTokens != null) params.max_tokens = cfg.maxTokens;
  if (cfg.thinking === "disabled") params.thinking = { type: "disabled" };
  return params;
}

const TOOL_PARAMS = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: ["person", "company"] },
    name: { type: "string" },
    dob: { type: "string" },
    country: { type: "string" },
    city: { type: "string" },
    passport: { type: "string" },
  },
  required: ["id", "type", "name"],
};

const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "match_list",
      description: "Query the OpenSanctions /match list for one party. Returns ranked list candidates.",
      parameters: TOOL_PARAMS,
    },
  },
];

const ANTHROPIC_TOOLS = [
  {
    name: "match_list",
    description: "Query the OpenSanctions /match list for one party. Returns ranked list candidates.",
    input_schema: TOOL_PARAMS,
  },
];

function parseDecision(text, partyId) {
  if (!text || typeof text !== "string") {
    return { id: partyId, decision: "invalid", reason: null, error: "empty model output" };
  }
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        json = JSON.parse(m[0]);
      } catch {
        json = null;
      }
    }
  }
  if (!json || typeof json !== "object") {
    return { id: partyId, decision: "invalid", reason: null, error: "invalid JSON" };
  }
  const decision = typeof json.decision === "string" ? json.decision.trim().toLowerCase() : "";
  if (!ALLOWED.has(decision)) {
    return {
      id: partyId,
      decision: "invalid",
      reason: json.reason != null ? String(json.reason) : null,
      error: `unknown decision: ${json.decision}`,
    };
  }
  return {
    id: partyId,
    decision,
    reason: json.reason != null ? String(json.reason) : "",
  };
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (!p) return "";
        return p.text || p.content || "";
      })
      .join("");
  }
  return "";
}

/* Messages API: the decision is read from "text" blocks only. "thinking" and
   "redacted_thinking" blocks are never read as the answer. */
function anthropicText(blocks) {
  return blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

function queryParty(args, slim) {
  const a = args && typeof args === "object" ? args : {};
  return {
    id: a.id || slim.id,
    type: a.type || slim.type,
    name: a.name || slim.name,
    dob: a.dob || slim.dob,
    country: a.country || slim.country,
    city: a.city || slim.city,
    passport: a.passport || slim.passport,
  };
}

async function runMatch(args, slim, listState) {
  const result = await matchList(queryParty(args, slim), listState);
  const top = result.candidates && result.candidates[0] ? result.candidates[0] : null;
  return { result, top };
}

function pickTop(current, next) {
  if (!next) return current;
  // Id and score only: the name on the list card stays in memory and in the local log.
  const row = { id: next.id, score: next.score };
  if (!current) return row;
  if ((next.score ?? 0) > (current.score ?? 0)) return row;
  return current;
}

function modelUrl(cfg) {
  if (cfg.style === "openai") return `${cfg.baseUrl}/chat/completions`;
  if (cfg.baseUrl.endsWith("/v1")) return `${cfg.baseUrl}/messages`;
  if (cfg.baseUrl.endsWith("/messages")) return cfg.baseUrl;
  return `${cfg.baseUrl}/v1/messages`;
}

function modelHeaders(cfg) {
  if (cfg.style === "openai") {
    return { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" };
  }
  return { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
}

/* The one place a request goes to the model provider. */
async function postModel(cfg, body) {
  const url = modelUrl(cfg);
  const res = await request("model", { method: "POST", url, body }, (signal) =>
    fetch(url, {
      method: "POST",
      headers: modelHeaders(cfg),
      body: JSON.stringify(body),
      redirect: "error",
      signal,
    }),
  );
  const data = res.body && typeof res.body === "object" ? res.body : {};
  if (data.model) seenModelIds.add(data.model);
  return { status: res.status, data };
}

async function openaiTurn(cfg, messages) {
  const params = modelParams(cfg);
  const body = {
    model: cfg.name,
    ...params,
    messages,
    tools: OPENAI_TOOLS,
    tool_choice: "auto",
  };
  const { data } = await postModel(cfg, body);
  const choice = (data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  return { data, msg, params };
}

async function anthropicTurn(cfg, messages) {
  const params = modelParams(cfg);
  const body = {
    model: cfg.name,
    ...params,
    system: SYSTEM,
    tools: ANTHROPIC_TOOLS,
    messages,
  };
  const { data } = await postModel(cfg, body);
  return { data, params };
}

/* --model-ping: one invented message, no tools, no system prompt, no row of the book. */
export async function modelPing(cfg) {
  const params = modelParams(cfg);
  const body = { model: cfg.name, ...params, messages: [{ role: "user", content: PING_MESSAGE }] };
  const { status, data } = await postModel(cfg, body);
  const choice = (data.choices && data.choices[0]) || {};
  const text =
    cfg.style === "anthropic" ? anthropicText(Array.isArray(data.content) ? data.content : []) : contentText((choice.message || {}).content);
  return { status, returnedModelId: data.model || null, params, responseSha256: responseSha256(text) };
}

export async function adjudicateParty(party, cfg, listState) {
  const slim = visibleParty(party);
  let matchCalls = 0;
  let topMatch = null;
  let returnedModelId = null;
  let sentParams = modelParams(cfg);
  const usage = [];
  const maxTurns = 8;

  try {
    if (cfg.style === "anthropic") {
      const messages = [{ role: "user", content: JSON.stringify(slim) }];
      for (let turn = 0; turn < maxTurns; turn++) {
        const { data, params } = await anthropicTurn(cfg, messages);
        sentParams = params;
        if (data.model) returnedModelId = data.model;
        if (data.usage) usage.push(data.usage);
        const blocks = Array.isArray(data.content) ? data.content : [];
        const toolUses = blocks.filter((b) => b && b.type === "tool_use");
        if (toolUses.length) {
          // Every block goes back unchanged and in order, thinking blocks included.
          messages.push({ role: "assistant", content: blocks });
          const results = [];
          for (const tu of toolUses) {
            if (tu.name !== "match_list") {
              results.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: JSON.stringify({ error: "tool not allowed" }),
              });
              continue;
            }
            matchCalls += 1;
            // A list error stops the run; it never reaches the model as a tool result.
            const { result, top } = await runMatch(tu.input || {}, slim, listState);
            topMatch = pickTop(topMatch, top);
            results.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({
                dataset: result.dataset,
                vintage: result.vintage,
                candidates: result.candidates,
              }),
            });
          }
          messages.push({ role: "user", content: results });
          continue;
        }
        const text = anthropicText(blocks);
        return finish(parseDecision(text, party.id), matchCalls, topMatch, returnedModelId, sentParams, usage, text);
      }
      return finish(
        { id: party.id, decision: "invalid", reason: null, error: "no decision after tool turns" },
        matchCalls,
        topMatch,
        returnedModelId,
        sentParams,
        usage,
        null,
      );
    }

    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(slim) },
    ];
    for (let turn = 0; turn < maxTurns; turn++) {
      const { data, msg, params } = await openaiTurn(cfg, messages);
      sentParams = params;
      if (data.model) returnedModelId = data.model;
      if (data.usage) usage.push(data.usage);
      const calls = msg.tool_calls || [];
      if (calls.length) {
        messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: calls,
        });
        for (const tc of calls) {
          const fn = tc.function || {};
          if (fn.name !== "match_list") {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ error: "tool not allowed" }),
            });
            continue;
          }
          matchCalls += 1;
          let args = {};
          try {
            args = JSON.parse(fn.arguments || "{}");
          } catch {
            args = {};
          }
          // A list error stops the run; it never reaches the model as a tool result.
          const { result, top } = await runMatch(args, slim, listState);
          topMatch = pickTop(topMatch, top);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              dataset: result.dataset,
              vintage: result.vintage,
              candidates: result.candidates,
            }),
          });
        }
        continue;
      }
      const text = contentText(msg.content);
      return finish(parseDecision(text, party.id), matchCalls, topMatch, returnedModelId, sentParams, usage, text);
    }
    return finish(
      { id: party.id, decision: "invalid", reason: null, error: "no decision after tool turns" },
      matchCalls,
      topMatch,
      returnedModelId,
      sentParams,
      usage,
      null,
    );
  } catch (err) {
    // A list error stops the run and an error without a class is a bug (exit 1);
    // a model error after retries makes the row invalid.
    if (err && (err.fatal || !err.errorClass)) throw err;
    return finish(
      {
        id: party.id,
        decision: "invalid",
        reason: null,
        error: { class: err.errorClass, status: err.httpStatus ?? null },
      },
      matchCalls,
      topMatch,
      returnedModelId,
      sentParams,
      usage,
      null,
    );
  }
}

function finish(parsed, matchCalls, topMatch, returnedModelId, params, usage, text) {
  const out = {
    id: parsed.id,
    decision: parsed.decision,
    reason: parsed.reason,
    matchCalls,
    returnedModelId,
    params,
    responseSha256: responseSha256(text),
  };
  if (typeof parsed.error === "string") {
    // No usable decision in the model output: the text goes to the log, the receipt gets the class.
    logEvent("error", { kind: "decision", id: parsed.id, error: parsed.error });
    out.error = { class: "no-decision", status: null };
  } else if (parsed.error) {
    out.error = parsed.error;
  }
  if (topMatch) out.topMatch = topMatch;
  // One entry per model response of this row, as the provider returned it.
  if (usage.length) out.usage = usage;
  return out;
}
