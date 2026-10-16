# Pack 02: kyc.sanctions-adjudication.v1

SAMPLE · not HOLDOUT · status in `pack-status.json`, printed by `--check` · no run in this folder

This folder is the working kit for first-line watchlist hit adjudication.
It is not a live bank book. It is not HOLDOUT.

## What is here

- Pack runner and SAMPLE book (`data.js`, `assemble.js`, `list.js`, `candidate.js`, `baseline.js`, `rubric.js`, `run.mjs`, `integrity.js`, `runlog.js`, `thresholds.js`, `packstatus.js`, `scoring.js`, `rescore.js`, `commitment.js`)
- `LICENSE`: Apache License 2.0, for the code; `LICENSE-BOOK`: CC BY-NC 4.0, for the book and the receipts (see "Licence")
- `pack-status.json`: whether the book is SAMPLE, how it was reviewed and who accepted it, pinned to the SHA-256 of the accepted `data.js`; read and checked by `packstatus.js` (see "Book" and "Review status")
- `thresholds.json`: every threshold of the grader and the baseline, read and checked by `thresholds.js` (see "Grading and thresholds")
- `system-prompt.txt`: the model's system prompt, read byte for byte (no trailing newline); its SHA-256 is in the model receipt
- `snapshot.json`: description of the dated list snapshot a run uses (see "List snapshot")
- `package.json`: ES module package; requires Node.js 18 or later (built-in `fetch`, top-level `await`)
- `.env.example`: keys stay empty until you sit the pack
- `.gitattributes`: every file is stored byte for byte (no line-ending conversion), so digests match on every machine
- `.gitignore`: keeps `.env` and `runs/` out of version control
- `SHA256SUMS`: SHA-256 hashes of every file of the kit except `SHA256SUMS` itself and the commitment files; `integrity.js` checks them before anything else runs (see "Exit codes")
- `COMMITMENT.md` and `COMMITMENT.json`: the pre-run commitment, signed before the runs (see "Pre-run commitment check"). They, and the signature and timestamp files next to them, are outside `SHA256SUMS`: they carry its digest, so no file of the kit carries theirs
- `watch-public.json`: eight Noted · Literature rows for map direction 03 (Sanctions / screening analyst). Not a leaderboard. Qualified into pack = 0. FinBalance and Project Hertha stay on the site Watch, not here (other packs).

## Who sits what

- **Candidate** — a named model in `CANDIDATE_MODEL`. The runner will not invent a model id. First pin, when you sit: Claude Sonnet. Sequential versioned runs only (no parallel bake-off).
- **List**: a `/match` server at `LIST_BASE_URL` (`list.js`), normally a local matching server loaded with the dated export described in `snapshot.json`. The dataset is the snapshot `scope`. OpenSanctions is the list vendor, not the candidate, not the reviewer.
- **Grader**: `rubric.js`. Not a model. Every number it uses is in `thresholds.json`.
- **Baseline**: `baseline.js` (`baseline.ofac-style-fuzzy.v1`). Deterministic: normalize → Jaro-Winkler / Levenshtein / token-set. Its thresholds are the `baseline` block of `thresholds.json`. Uses the same OpenSanctions `/match` list tool as the candidate; OpenSanctions is still list vendor only, not the reviewer. The OpenSanctions `ofac` API algorithm is not this baseline.

## Book

SAMPLE, n=69 (25 hit / 14 hold / 30 clear). Not HOLDOUT. Book version 2 (`META.bookVersion`), 2026-10-03: from that day the rows derived from listed entities are entity ids and variant recipes; the pack version (`META.pack`) is still `v1`. Expanded 2026-09-09. `--check` prints `BOOK_VERSION`, and every receipt names it in `meta.bookVersion`.

The status of the book (SAMPLE, review, acceptance) is declared in `pack-status.json` and printed by `--check` (`PACK_STATUS` and `BANNER`). An acceptance names the SHA-256 of the accepted `data.js`: a book changed after it is not accepted, and `--baseline` and `--model` refuse to start until `pack-status.json` accepts the `data.js` they run on. The gold answer of every row is public: it is in `data.js` and in the grade of every completed receipt.

A row derived from a listed entity (37 rows, 13 entities) holds no name, date, document or place from the list. It carries the entity id (`entity`; for rows with a `seed` page, the last segment of that page), its two-letter `country` code, checked against the entity, and a variant `recipe`. The runner builds the visible row from the dated export at run time (`assemble.js`). The other 32 rows are invented and kept as literals. `--check` prints `BOOK entity=… literal=… entities=…`, counted from `data.js` alone.

### Recipes (recipeVersion 1)

Tokens are the parts of a string split on single spaces, counted from 0. Operations apply in the order given. Case changes use `toUpperCase()` and `toLowerCase()` without a locale; nothing else is normalised, trimmed or recombined.

- `name.from`: where the name starts:
  - `caption`: the entity's caption;
  - `name-diacritic`: the one `name` value that is not the caption but equals it after removing diacritics (`normalize("NFKD")`, combining marks dropped) and lowercasing;
  - `weakAlias`: the `weakAlias` values without repeats, sorted by code point, item `name.index` (default 0);
  - `lastName`: the one `lastName` value;
  - `literal`: the row's own `name`.
- `name.ops`:
  - `["upper"]`: the whole string in upper case;
  - `["title"]`, `["title", [k…]]`: each token with its first character in upper case and the rest in lower case; tokens `k` unchanged;
  - `["keep", [i…]]`: only these tokens, in this order;
  - `["surname-first"]`: tokens 1… in upper case, then `", "` and token 0;
  - `["initial", i]`: token `i` becomes its first character and `"."`;
  - `["typo", t, pos, ch]`: in token `t`, the character at `pos` becomes `ch`;
  - `["legal-ltd"]`: the last token, `limited` in any case, becomes `Ltd`;
  - `["suffix", s]`: appends `" " + s`;
  - `["insert", pos, w]`: inserts token `w` at `pos`.
- Attributes:
  - `dob: "card"`: the one `birthDate`, as `YYYY-MM-DD`; `dob: { yearShift: n }`: the same date with `n` added to the year;
  - `passport: "card"`: the one `passportNumber`;
  - `city: "card"`: the one `city` of the one `Address` the entity names in `addressEntity`;
  - `country: "card"`: the row's code is among the entity's `nationality`, `citizenship` and `country` values, in any case; `country: "other"`: it is not.

`why` is one code, or two joined by `+`. Derived rows: `exact` (the name as on the card), `case` (only letter case differs), `caps` (in capitals), `diacritic` (the accented spelling on the card), `surname-first`, `typo` (one character changed), `initial` (a given name cut to its initial), `legal-form` (short legal form), `alias` (a weak alias), `partial` (some name tokens dropped), `other-year` (the birth date with another year), `other-country` (a country not on the card), `company-from-person` (a company named after a listed person), `inserted-token` (one extra token), `dob-donor` (an invented name with a listed birth date). Literal rows: `invented` (not drawn from the list), `lookalike` (invented, shares one name token with a listed name), `generic-fragment` (generic words only).

### Assembly

`LIST_EXPORT_PATH` names the entities file of the export (`entities.ftm.json`). The kit reads one format, `application/json+ftm`: one FollowTheMoney entity as JSON per line, addresses as separate `Address` entities. Before any network call and before `runs/` is created, `exportFormat` in `snapshot.json` must be `application/json+ftm` and the SHA-256 of the file must equal `exportSha256`; otherwise the run exits 2. The path is never printed, logged or recorded.

The runner reads only the entities the book names and the addresses their recipes need; each id must occur exactly once. It then checks every row in book order: the entity's schema is `recipe.schema`; its `referents` include `ofac-<ofac>` when the row has `ofac`; the recipe's preconditions hold; the attributes match. The first failure stops the assembly with the row id and a code: `missing-entity`, `duplicate-entity`, `schema`, `ofac`, `missing-property`, `ambiguous`, `index`, `op`, `country`, `date`. A run whose book does not assemble is not completed and sends nothing to the list (see "Runs, retries and logs").

The visible row has the keys `id`, `type`, `name`, `dob`, `country`, `city`, `passport`, empty ones left out; `type` and `country` come from the book. `inputSha256` is the SHA-256 of its JSON; `assemblySha256` is the SHA-256 of the lines `<id> <inputSha256>` in book order. Receipts carry `input: { recipeVersion, assemblySha256, parties }`: each row's id, source and `inputSha256`, and for a derived row its entity id and recipe, never an assembled value. Assembled rows go only to `/match`, to the model and to the local log. The receipt names the top list candidate by id and score only (the baseline adds its schema), and the baseline's `reason` is a code: `thin-weak-hold`, `weak-clear`, `schema-mismatch`, `score-hit`, `thin-elevated-hold`, `score-hold`, `score-clear`.

`node run.mjs --assemble` assembles the book without keys, network or `runs/`. It prints `ROW <id> entity|literal <inputSha256>` for each row and `ASSEMBLY completed rows=… entity=… literal=… sha256=<assemblySha256>`, or `ASSEMBLY not-completed row=<id> code=<code>` and exits 4. It never prints a value of a row.

## Fatal

Missed sanction: a gold hit posted as clear.
Do not mix with pack 03 AML TM L1 (that fatal is auto-close of a seeded true hit).

## PUBLIC first-sit path

1. SAMPLE book public (entity IDs and variant recipes).
2. Private list snapshot proven by SHA-256 digest + date published *before* the run, as described in `snapshot.json`. Provider immutability is not proof.
3. Deterministic baseline run on the same book and the same list vintage, same receipt shape.
4. Then one named-model run (Claude Sonnet). Later models: separate versioned files, not a parallel bake-off.
5. Independent reviewer is not OpenSanctions.

A run without the pre-run digest and without the baseline is incomplete.

## Baseline

```
node run.mjs --baseline
```

Needs `LIST_BASE_URL`, a complete `snapshot.json`, a complete `thresholds.json` and `LIST_EXPORT_PATH` (no model). Writes `runs/<runId>.json`, its log and a copy `runs/baseline-latest.json` (see "Runs, retries and logs"). Publish the list-snapshot digest *before* this run. A model sit without a baseline receipt on the same book and vintage is incomplete.

## How to run

Copy `.env.example` to `.env`. Set keys. Then:

```
node run.mjs --check
node run.mjs --freeze-check
node run.mjs --list-ping
node run.mjs --model-ping
node run.mjs --assemble
node run.mjs --rubric-test
node run.mjs --baseline
node run.mjs --model
node run.mjs --rescore <receipt> [--manifest <result manifest>]
```

Name exactly one mode. `--rescore` takes the path of a receipt and, optionally, `--manifest` followed by the path of a result manifest, in that order. No mode, an unknown argument, more than one mode, `--rescore` without a path or with anything else after it, or `--manifest` without a path, repeated or without `--rescore` prints the usage and exits 2; nothing is written.

`--check` loads the book and reports whether `snapshot.json` and `thresholds.json` are complete. It prints `BOOK_VERSION`, `PACK_STATUS sample=… review=… accepted=none|<date> book=match|mismatch sha256=<statusSha256>` (or `PACK_STATUS invalid keys=…`), the `BANNER` built from `pack-status.json`, `RECEIPT schemaVersion=1` and the state of the pre-run commitment: `COMMITMENT absent` (neither `COMMITMENT.md` nor `COMMITMENT.json`), `COMMITMENT invalid` (one of them missing, or `COMMITMENT.json` not a JSON object), `COMMITMENT incomplete tbd=<markers TBD in both files>` or `COMMITMENT present ordinal=<n> sha256=<SHA-256 of COMMITMENT.json>`. No keys. No network.
`--freeze-check` checks the frozen files and the pre-run commitment (see "Pre-run commitment check"). No keys, settings, network, export or `runs/`, and it does not read `.env`.
`--list-ping` sends one invented probe to `/match` and prints the list version the server serves. Needs `LIST_BASE_URL`; works without a complete `snapshot.json`. Dataset: the `snapshot.json` `scope` when the description is complete (then `OS_DATASET` set and different from `scope` exits 2); otherwise `OS_DATASET`, else `us_ofac_sdn`. If `snapshot.json` sets `listVersion` and `versionCheck` is `"response"`, a different served version exits 4. It writes a log in `runs/` and ends with the run lines (see "Runs, retries and logs"); it writes no receipt.
`--model-ping` sends one invented message to the model: no tools, no system prompt, no row of the book. It prints `MODEL_PING status=… returnedModelId=… params=…` (the parameters sent) and `RESPONSE sha256=…` (the SHA-256 of the text of its answer, computed as `responseSha256` in a decision row; `null` without one), then the run lines; it writes a log but no receipt. It needs the model settings only: no `LIST_BASE_URL`, no `snapshot.json`, no list key. A request that fails after retries exits 4.
`--assemble` builds the book rows from the export and prints their digests (see "Book"). Needs a complete `snapshot.json` and `LIST_EXPORT_PATH`; no keys, no network, no `runs/`.
`--rubric-test` runs synthetic answer sets through the grader (see "Grading and thresholds"). Needs a complete `thresholds.json`; no keys, no network, no export, no `runs/`.
`--baseline` seats the fuzzy baseline in one pass. Needs `LIST_BASE_URL`, a complete `snapshot.json`, a complete `thresholds.json` and `LIST_EXPORT_PATH`.
`--model` sits the named model in `repeats.n` passes. Needs `LIST_BASE_URL`, a complete `snapshot.json`, a complete `thresholds.json`, `LIST_EXPORT_PATH`, the model settings and a pre-run commitment that passes `--freeze-check` and declares those settings (see "Pre-run commitment check"). There is no dry pass.
`--rescore` grades a published receipt again from its decision rows (see "Re-scoring a published receipt"). Needs a complete `thresholds.json`; no keys, settings, network, export or `runs/`, and it does not read `.env`. It writes nothing and never prints a path.

Configuration errors exit 2 before any network call: `LIST_BASE_URL` empty or not an http(s) URL; `snapshot.json` with an empty or invalid field (the message lists them); `OS_DATASET` set and different from the snapshot `scope`; `thresholds.json` with an empty or invalid cell (the message names each one); `pack-status.json` invalid (`pack-status.json: invalid: <keys>`), without an acceptance (`pack-status.json: empty: accepted.date, accepted.bookSha256`) or accepting other bytes than the `data.js` of the run (`pack-status.json: accepted.bookSha256 does not match data.js`), for `--baseline` and `--model` only; a model setting missing or invalid (see "Settings"); for `--model`, a commitment that fails `--freeze-check` (`COMMITMENT: the freeze check fails …`) or whose `candidate` and `run` blocks differ from the settings in force (`COMMITMENT.json: candidate or run differs from <variables>`, names only); `LIST_EXPORT_PATH` empty or unreadable, its SHA-256 different from `exportSha256`, or `exportFormat` not `application/json+ftm`; `LIST_TIMEOUT_MS`, `MODEL_TIMEOUT_MS` or `RETRY_MAX` not a whole number in range; `runs/` or the run log cannot be created.

## Settings

Settings come from the environment, or from `.env` next to `run.mjs` for variables the environment does not set. Every default is in this table; a model parameter without a value is not sent.

| Variable | Required | Default | In the receipt |
|---|---|---|---|
| `LIST_BASE_URL` | `--list-ping`, `--baseline`, `--model`; an http or https URL | none | no; only the path `/match/<scope>` |
| `LIST_EXPORT_PATH` | `--assemble`, `--baseline`, `--model`; the entities file of the export | none | no; never printed or logged |
| `OPENSANCTIONS_API_KEY` | only when `LIST_BASE_URL` is the hosted API | none | no; replaced by `[redacted]` in logs |
| `OS_DATASET` | no; if set, must equal the snapshot `scope` | `us_ofac_sdn`, for `--list-ping` without a complete `snapshot.json` only | no; the dataset recorded is the `scope` |
| `LIST_TIMEOUT_MS` | no; whole number 1-2147483647 | 30000 | `run.listTimeoutMs` |
| `MODEL_TIMEOUT_MS` | no; whole number 1-2147483647 | 120000 | `run.modelTimeoutMs` |
| `RETRY_MAX` | no; whole number ≥ 0 | 2 | `run.retryMax` |
| `CANDIDATE_MODEL` | `--model-ping`, `--model` | none | `candidate.name` |
| `CANDIDATE_BASE_URL` | `--model-ping`, `--model` | none | no |
| `CANDIDATE_API_KEY` | `--model-ping`, `--model` | none | no; replaced by `[redacted]` in logs |
| `CANDIDATE_API_STYLE` | `--model-ping`, `--model`; exactly `openai` or `anthropic` | none | `candidate.apiStyle` |
| `CANDIDATE_TEMPERATURE` | no; a number when set | not sent | `params.temperature`, only when sent |
| `CANDIDATE_MAX_TOKENS` | style `anthropic`; whole number above 0. Style `openai` sends it under the name `max_tokens` | not sent (style `openai`) | `params.max_tokens`, only when sent |
| `CANDIDATE_THINKING` | style `anthropic`: exactly `disabled` or `adaptive`; must be empty for style `openai` | none | `candidate.thinking`; `params.thinking` when sent |
| `CANDIDATE_PROVIDER` | no | the API style | `candidate.provider` |

The model receipt records exactly the parameters each request body carried: `candidate.params`, and `params` with `returnedModelId` in every decision row. `candidate.returnedModelIds` lists every model id the provider returned, and `candidate.systemPromptSha256` is the SHA-256 of `system-prompt.txt`. More than one returned model id, more than one set of parameters, or a returned model id other than `CANDIDATE_MODEL` is recorded in `deviations`. Each decision row also carries `usage`: one entry per model response of that row, as the provider returned it.

With style `anthropic`, `CANDIDATE_THINKING=disabled` sends `thinking: {"type": "disabled"}`; `adaptive` sends no `thinking` field and leaves the provider's adaptive thinking on. A response may then start with `thinking` or `redacted_thinking` blocks: the decision is read from `text` blocks only and tool calls from `tool_use` blocks only, and every block is sent back unchanged and in order with the tool results. The `anthropic` request sends no `tool_choice`; the `openai` request sends `"auto"`.

This folder still has no model `runs/` file until you sit one.

## Exit codes

Every mode, `--check` included, first checks `SHA256SUMS`: before `.env` is read and before any network call.

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | Unexpected error. If it happens after the run log was opened, the log is closed and `RUN`, `STATUS not-completed` and `LOG` are printed; no receipt is written. |
| 2 | Refused by the command line (not exactly one known mode, or the arguments of `--rescore` and `--manifest` wrong) or by configuration, before any network call (see "How to run"). `--freeze-check` exits 2 with `FREEZE failed` when any check finds something. `--rescore` also exits 2 with `RESCORE refused reason=<code>` when the receipt cannot be read or is not JSON (`json`), its `schemaVersion` is not `1` (`schema`), it has no `passes` without being not completed or its `runId` names no mode (`shape`), or the result manifest cannot be read, is not JSON or has another form (`manifest`). |
| 3 | Refused by digests, before any network call: a file named in `SHA256SUMS` is missing or differs (`SHA256SUMS: <file>: FAILED`), a file the kit cannot run without is not named there (`SHA256SUMS: <file>: not listed`; the list is in `integrity.js`), a line of `SHA256SUMS` is malformed, or `SHA256SUMS` cannot be read. |
| 4 | Run or assembly not completed, without the verdict `failed`. `--baseline` and `--model`: the book did not assemble from the export, a list request failed after retries (in the probe or in any row, in the baseline or in the model's tool), the list version is missing or different, or a pass was left not completed by its invalid rows; the receipt says `status: "not-completed"` and has no summary `rubric` (see "Grading and thresholds"). `--assemble`: the book did not assemble. `--list-ping`: the request failed after retries, or the served version did not match. `--model-ping`: the request failed after retries. |
| 5 | Outcome `failed`: a completed run, or a run not completed that already has the verdict `failed` (see "Grading and thresholds"). `rerun` does not change the code. |
| 6 | `--rescore`: the re-scoring differs from the receipt, or the receipt is not listed in the given result manifest (`RESCORE mismatch`): it does not belong to the files of this kit, its passes have the wrong form, or a recomputed value differs (see "Re-scoring a published receipt"). `--rescore` never exits 4 or 5 itself: the code the run had is the `exit=` of its lines. |

To check the digests by hand: `sha256sum -c SHA256SUMS` (on macOS: `shasum -a 256 -c SHA256SUMS`). The runner is stricter: a line of `SHA256SUMS` that is not `<64 hex digits><two spaces><file>` exits 3, where `sha256sum -c` only warns.

## Runs, retries and logs

Each run of `--list-ping`, `--baseline` and `--model` has an id, `runId`: the mode, the UTC time and a short random suffix (for example `baseline-20000101T000000Z-0a1b2c`). Before the first network call the runner creates `runs/` and opens the run log; if it cannot, it exits 2 and sends nothing.

- **Receipt.** `--baseline` and `--model` write `runs/<runId>.json` once and never overwrite it, then copy it to `runs/baseline-latest.json` or `runs/latest.json`. Two runs give two receipts.
- **Assembly.** After the log is opened, the book is assembled from the export (see "Book"). If a row does not assemble, the run stops before any request: the receipt says `status: "not-completed"` with `reason: { class: "assembly", code, row }`, no `input` and no decisions, and the output says `REASON assembly code=<code> row=<id>` (exit 4).
- **Probe.** Before the first row of the book, one invented party that is not in the book is sent to `/match`, as in `--list-ping`. It also checks the list version.
- **Timeouts and retries.** `LIST_TIMEOUT_MS` (default 30000) and `MODEL_TIMEOUT_MS` (default 120000) limit each list and model request; `RETRY_MAX` (default 2) is the number of retries. A request is retried only after a network error, a timeout, HTTP 429 or 5xx, after a fixed pause of 1000 ms; `Retry-After` is not read. Redirects are not followed: a redirect fails as a network error. The values in force are in the receipt block `run`.
- **One rule for list errors.** A list request that fails after retries, in the probe or in any row, in the baseline or in the model's tool, stops the run. So does a list version that is missing or different. The receipt then says `status: "not-completed"` with `reason: { class, status }` (and `pass` when the stop was inside a pass), keeps the decisions made before the stop, and exits 4, or 5 with the verdict `failed` (see "Grading and thresholds"). A model request that fails after retries makes only its row `invalid`. A completed run says `status: "completed"`.
- **Errors in receipts** are `{ class, status }`: `status` is the HTTP status when there was a response, else `null`. Classes: `network` (no response, refused connection or redirect), `timeout`, `http` (an error status), `parse` (a response that is not JSON, or a list response without a `results` array for a query), `version` (list version missing or different), `no-decision` (the model gave no usable decision), and for a stopped run also `assembly` (with `code` and `row` instead of `status`) and `invalid` (a pass left not completed by its invalid rows, with `count`, `max` and `fatal`). In `invalidByClass` an invalid row without an error counts as `unparsed` and a row without an answer as `missing`. The full error text is only in the log.
- **Calls.** The receipt counts requests in `calls: { list: { ok, failed, retries }, model: { ok, failed, retries } }`, and each pass carries its own `calls`. A decision row carries none: retries differ from run to run, and the rows of two runs are compared byte for byte (see "Receipt schema"). The requests and retries of each row are in the log. During a pass every log event carries its `pass` number.
- **Provider.** The model receipt names `provider`: `CANDIDATE_PROVIDER`, or the API style when it is empty. Receipts carry no address.
- **Log.** `runs/<runId>.log.jsonl` has one JSON line per event: each list request (method, address, body) and response (status, body), each model request (address, body) and raw response, each retry and each error with its full text. Headers are not logged, and the values of `OPENSANCTIONS_API_KEY` and `CANDIDATE_API_KEY` are replaced by `[redacted]`. The receipt names the log and its SHA-256 in `log: { file, sha256 }`. Receipts are published; logs and `runs/` stay local and are not published with the kit, because a log holds the rows assembled from the export, the raw model responses with their reason text and the candidates of the list responses.
- **Output.** A run ends with `RUN <runId>`, `STATUS completed|not-completed`, `REASON <class> <status>` when not completed (`REASON invalid count=… max=… fatal=…` for a pass left not completed by its invalid rows, `REASON assembly code=… row=…` for the book, and `pass=<i>` at the end when the stop was inside a pass), `CALLS list ok=… failed=… retries=… model ok=… failed=… retries=…`, `LOG <file> <sha256>` and `WROTE <file>`. `--list-ping` and `--model-ping` end with the same lines without `WROTE`. `--baseline` and `--model` then print `THRESHOLDS sha256=<thresholdsSha256>`; one line per pass, `PASS <i> STATUS completed OUTCOME <outcome> GATE <gate>` or `PASS <i> STATUS not-completed CLASS <class> MISSED <missed sanctions answered>`, ending with `OUTCOME failed GATE <gate>` when that pass has the verdict, each followed by `DECISIONS pass-<i> rows=<rows> sha256=<decisionsSha256>`; then `OUTCOME`, `GATE` and `NUMBERS` of the run when completed (`OUTCOME` and `GATE` also with the verdict `failed`), and `RERUN eligible|not-eligible` when not completed. No line carries a row of the book.

## Grading and thresholds

### `thresholds.json`

Every number that moves an outcome is in `thresholds.json`, covered by `SHA256SUMS`. While any of its 14 cells is empty or invalid, `--baseline`, `--model` and `--rubric-test` refuse to start (exit 2, before any network call and before `runs/`), and the message names each cell by its full key. `--check` prints `THRESHOLDS complete sha256=…`, `THRESHOLDS incomplete empty=…` or `THRESHOLDS invalid keys=…`. Every receipt of `--baseline` and `--model`, completed or not, carries `thresholdsSha256`, the SHA-256 of the file, and `thresholds`, its content. The code holds no default for any cell.

| Key | Type | What it decides |
|---|---|---|
| `thresholdsVersion` | `1` | format of the file; not a threshold |
| `rubric.holdMax` | whole number ≥ 0, hold answers in a pass | `failed` when a pass has more hold answers |
| `rubric.worksHoldMax` | whole number ≥ 0, at most `holdMax` | `works` at or below it, `works-with-controls` above it |
| `rubric.hitPrecisionMin` | number 0-1 | `failed` when hit precision is below it |
| `rubric.invalid.maxRows` | whole number ≥ 0, invalid rows in a pass | not completed when a pass has more invalid rows |
| `rubric.invalid.withinTolerance` | `"hold"` | an invalid row within the tolerance counts as a hold answer |
| `repeats.n` | whole number ≥ 1 | full passes of the model over the book |
| `repeats.aggregation` | `"worst-pass"` | how the passes of a run combine |
| `intervals.method` | `"clopper-pearson-upper"` | the bound |
| `intervals.level` | number strictly between 0 and 1 | level of the one-sided bound |
| `intervals.metrics` | `["missedRate"]` | the measures that get a bound |
| `perEntity` | `true` or `false` | whether receipts show per-entity numbers; there is no per-entity gate |
| `baseline.hitMin`, `baseline.holdMin`, `baseline.thinHoldFloor` | numbers 0-1, `thinHoldFloor` ≤ `holdMin` ≤ `hitMin` | the baseline ladder in `baseline.js` |

A value outside its type or set, a key the file does not define, a `thresholdsVersion` other than `1`, or a pair out of order (`worksHoldMax` above `holdMax`, or the baseline order broken; both cells are named) is invalid.

### One pass

The answer of a row is `hit`, `hold` or `clear`; any other answer, a row without an answer and a row whose model request failed after retries are `invalid`. A fatal row is a gold hit row. In order:

1. A pass is **not completed**, with no outcome from the gates, when it has more invalid rows than `rubric.invalid.maxRows`, invalid rows only, an invalid fatal row, or a row whose model request lost its connection: a network error, a timeout, HTTP 429 or 5xx after retries. Another HTTP 4xx is not a lost connection. These rules hold whatever the tolerance.
2. Any other invalid row counts as a hold answer everywhere: in the hold gates, in `all-hold` and in manual work; on a hold row it is a correct hold. `invalidN` and `invalidByClass` still show how many hold answers were invalid rows.
3. Gates, in order; the first that fires decides:

| # | Condition | outcome | gate |
|---|---|---|---|
| 1 | a fatal row answered clear | `failed` | `missed-sanction` |
| 2 | hold on every row | `failed` | `all-hold` |
| 3 | hold answers above `holdMax` | `failed` | `hold-max` |
| 4 | hit precision (correct hits / hit answers) below `hitPrecisionMin`; not applied without a hit answer | `failed` | `hit-precision` |
| 5 | hold answers at most `worksHoldMax` | `works` | `hold-works` |
| 6 | otherwise | `works-with-controls` | `hold-controls` |

The hold gates count rows, not shares. A hit on a hold row is not a correct hit and lowers the precision.

- Manual work counts each row once: a hold answer, a hit on a row whose gold is not hit, or a hold row that did not get hold. `manualN`, `manualShare` and the breakdown `manual` are numbers, not gates.
- A hit is credited by the answer. Beside it, without a gate: `hitEntityMatch`, correct hits whose `topMatch.id` is the entity of the row, and `hitNoListCall`, correct hits given without a list call (`matchCalls` 0). `topMatch` is the best-scoring candidate of all list calls on the row, not the candidate the model named; the grader reads `topMatch.id` and `matchCalls` for these two numbers only.
- `intervals.missedRate` is the exact one-sided upper bound (Clopper-Pearson) of the share of missed sanctions at `intervals.level`, over the gold hit rows of one pass: passes go over the same rows and are not pooled, so its `n` is the number of gold hit rows. Its `scope` says that it describes this SAMPLE book, not the task class. Gates compare point values, not bounds.
- With `perEntity: true`, `entity` counts the entities of the book, those with a gold hit row, those with a gold hit row answered clear (`missedEntities` lists their ids) and those whose gold hit rows were all answered hit.

### A run

- `--model` makes `repeats.n` passes in a row over the same assembled rows, with one configuration; `--baseline` makes one (`repeats: { n: 1 }`). A completed run is graded by its worst pass (`failed`, then `works-with-controls`, then `works`): `rubric` is the result of that pass with `rule: "worst-pass"` and its `pass` number, the bound of the pass with the most missed sanctions, and `agreement`, the share of rows where every pass gave the same answer (every invalid answer is one value).
- A pass that is not completed ends the run: no later pass runs, and the receipt says `status: "not-completed"`. Its `reason` names the pass: a list error or list version (class `network`, `timeout`, `http`, `parse` or `version`), or its invalid rows (class `invalid`). That pass keeps its decisions and `numbers` (rows so far, missed sanctions among the answers, invalid rows by class); the completed passes before it keep their `rubric` and `grade`.
- A run that is not completed still fails, outcome `failed` and exit 5, when one of its completed passes failed, or when the answered rows of the stopped pass already make failure certain: a fatal row answered clear, more hold answers than `holdMax`, or a best reachable hit precision `(correct hits + r) / (hit answers + r)` below `hitPrecisionMin`, where `r` counts the gold hit rows without an answer. Gate and pass are those of the first pass that failed, and the summary says `rule: "not-completed-verdict"`. Otherwise the run has no outcome and exits 4.
- `rerun`, present only when the run is not completed, says whether its cause allows a rerun. It is `eligible` when the runner stopped before the first pass (assembly, probe or list version, whatever the class); when the stopped pass would have met the invalid rule without its lost connections; or when the runner stopped a pass after a lost connection, an unreadable list response or a list version that did not match, and the rows before the stop had no invalid fatal row and no more invalid rows than `maxRows`. Another HTTP status inside a pass does not allow it. A model run with the verdict `failed` is `not-eligible`; for the deterministic baseline the verdict does not change `rerun`.
- The kit does not link or count attempts: a rerun is a new run with its own `runId`, log and receipt. A run stopped by a signal, or one that fails unexpectedly after its log was opened, leaves no receipt. Rerunning a run is not retrying a request (`RETRY_MAX`).

### `--rubric-test`

`node run.mjs --rubric-test` grades synthetic answer sets built from the ids, gold and entities of the book (all hold, all hit, all clear, all invalid, empty, perfect, one missed sanction, held clears, false hits, invalid rows, lost connections, runner stops and others) through the grader and the run summary alone: no keys, no network, no export, no `runs/`. It needs a complete `thresholds.json`. It prints `THRESHOLDS sha256=…`, then one `RUBRIC` line per set (completed: outcome, gate, rows, missed sanctions, hold answers, hit precision, invalid rows and manual share; not completed: invalid rows or rows before the stop, missed sanctions, the verdict if any and `rerun`), followed for completed sets by `CI` (the bound), `HIT` (correct hits, `hitEntityMatch`, `hitNoListCall`) and `ENTITY`; then `AGG` lines that combine sets as the passes of a model run. Every line ends with the exit code a run with that result would give. It never prints a value of a row.

## Receipt schema (schemaVersion 1)

Every receipt of `--baseline` and `--model` starts with `schemaVersion: 1` and `licence: "CC-BY-NC-4.0"`. One function writes the keys of both, in one order; only the candidate block, `deviations` and `repeats` differ. The table names every top-level key and every second-level key; a path is written as the key list below prints it: an array of objects is `name[]`, a key of an object inside it is `name[].key`, and nothing deeper than the second level has a row. Present: `all` is every receipt of both modes, completed or not; otherwise the modes and statuses are named. Scope: `common` keys describe the run (identity, status, digests, thresholds, passes, calls, log, deviations, environment, pack status), and the next pack keeps them with the same name and meaning; `pack` keys describe the list, the form of the book and the decision rows of this pack.

| Key | Type | Present | Scope | Meaning and source |
|---|---|---|---|---|
| `schemaVersion` | number | all | common | Version of this schema, `1`; the first key. |
| `licence` | string | all | common | `CC-BY-NC-4.0`: the receipt is under the licence of the book (see "Licence"). |
| `runId` | string | all | common | Mode, UTC time and a random suffix; the receipt is `runs/<runId>.json`. |
| `status` | string | all | common | `completed` or `not-completed`. |
| `reason` | object | not-completed | common | What stopped the run. |
| `reason.class` | string | not-completed | common | `network`, `timeout`, `http`, `parse`, `version`, `assembly` or `invalid` (see "Runs, retries and logs"). |
| `reason.status` | number or null | not-completed by a list error | common | HTTP status of the list response; `null` without one. |
| `reason.pass` | number | not-completed inside a pass | common | The pass that stopped. |
| `reason.count` | number | not-completed, class `invalid` | common | Invalid rows of that pass. |
| `reason.max` | number | not-completed, class `invalid` | common | `rubric.invalid.maxRows` of `thresholds.json`. |
| `reason.fatal` | number | not-completed, class `invalid` | common | Invalid fatal rows of that pass. |
| `reason.code` | string | not-completed, class `assembly` | pack | Assembly code (see "Book"). |
| `reason.row` | string | not-completed, class `assembly` | pack | Id of the row that did not assemble. |
| `rerun` | string | not-completed | common | `eligible` or `not-eligible`: whether the cause allows a rerun (see "A run"). A baseline receipt can be `eligible` with the verdict `failed`. |
| `kit` | object | all | common | The frozen file set. |
| `kit.sha256sums` | string | all | common | SHA-256 of the `SHA256SUMS` bytes checked at start: every file named there matched before any network call. |
| `packStatus` | object | all | common | The pack status with the digest of its file. |
| `packStatus.statusSha256` | string | all | common | SHA-256 of `pack-status.json`. |
| `packStatus.sample` | boolean | all | common | `sample` of `pack-status.json`. |
| `packStatus.review` | string | all | common | `review` of `pack-status.json`: `internal` or `independent`. |
| `packStatus.accepted` | object | all | common | `{ by, date, bookSha256 }` of `pack-status.json`; a run starts only when `bookSha256` is the SHA-256 of its `data.js`. |
| `commitment` | object or null | all | common | The pre-run commitment the run ran under, read before the run: `{ ordinal, sha256 }` when every check of `--freeze-check` passed, else `null` (a closed rehearsal before the commitment). A link back: the commitment does not name the receipt. |
| `commitment.ordinal` | number | with a commitment | common | `ordinal` of `COMMITMENT.json`. |
| `commitment.sha256` | string | with a commitment | common | SHA-256 of the bytes of `COMMITMENT.json`. |
| `meta` | object | all | pack | The pack. |
| `meta.id` | string | all | pack | `META.id` of `data.js`. |
| `meta.pack` | string | all | pack | Version of the pack, `META.pack`. |
| `meta.bookVersion` | string | all | pack | Version of the book, `META.bookVersion`. |
| `meta.title` | string | all | pack | `META.title`. |
| `meta.banner` | string | all | common | The banner built from `pack-status.json`. |
| `meta.fatal` | string | all | pack | The fatal condition of the pack. |
| `when` | string | all | common | UTC time the receipt was written, after the last pass. |
| `runtime` | object | all | common | The runtime. |
| `runtime.node` | string | all | common | Node.js version. |
| `run` | object | all | common | Request settings in force. |
| `run.listTimeoutMs`, `run.modelTimeoutMs`, `run.retryMax`, `run.retryDelayMs` | number | all | common | Timeouts, retries and the pause between retries (see "Runs, retries and logs"). |
| `candidate` | object | all | common | Who answered. |
| `candidate.name` | string | all | common | The baseline id, or `CANDIDATE_MODEL`. |
| `candidate.kind`, `candidate.family`, `candidate.notModel`, `candidate.methods[]` | string, boolean, array of strings | baseline | pack | Description of the baseline. |
| `candidate.provider`, `candidate.apiStyle`, `candidate.thinking` | string (`thinking` may be `null`) | model | common | `CANDIDATE_PROVIDER` or the API style, the API style, `CANDIDATE_THINKING` (see "Settings"). |
| `candidate.params` | object | model | common | The parameters every request body carried. |
| `candidate.returnedModelIds[]` | array of strings | model | common | Every model id the provider returned, over all passes. |
| `candidate.systemPromptSha256` | string | model | common | SHA-256 of `system-prompt.txt`. |
| `deviations[]` | array | model | common | Empty when nothing deviated. |
| `deviations[].kind` | string | model, with a deviation | common | `returned-model-ids`, `params` or `returned-model-id-differs`. |
| `deviations[].ids[]`, `deviations[].sets[]`, `deviations[].requested`, `deviations[].rows[]` | arrays, string | model, with a deviation | common | The ids, the parameter sets, the requested id, the row ids. |
| `toolsAllowed[]` | array of strings | all | pack | The one list tool. |
| `list` | object | all | pack | The list. |
| `list.vendor` | string | all | pack | `OpenSanctions`. |
| `list.endpoint` | string | all | pack | `/match/<scope>`; never an address. |
| `snapshot` | object | all | pack | The snapshot description. |
| `snapshot.descriptionVersion`, `snapshot.scope`, `snapshot.exportDate`, `snapshot.exportSha256`, `snapshot.exportFormat`, `snapshot.server`, `snapshot.listVersion`, `snapshot.versionCheck` | as in `snapshot.json` | all | pack | The fields of `snapshot.json` (see "List snapshot"); `scope` is the dataset, `listVersion` the list version. |
| `snapshot.descriptionSha256` | string | all | pack | SHA-256 of `snapshot.json`. |
| `input` | object | all where the book assembled | pack | The assembled book, by digest. |
| `input.recipeVersion` | number | all where the book assembled | pack | `META.recipeVersion`. |
| `input.assemblySha256` | string | all where the book assembled | pack | SHA-256 of the lines `<id> <inputSha256>`. |
| `input.parties[]` | array | all where the book assembled | pack | Per row: id, source and `inputSha256`, and for a derived row its entity id and recipe; never an assembled value. |
| `thresholdsSha256` | string | all | common | SHA-256 of `thresholds.json`. |
| `thresholds` | object | all | common | The content of `thresholds.json`. |
| `thresholds.thresholdsVersion`, `thresholds.rubric`, `thresholds.repeats`, `thresholds.intervals`, `thresholds.perEntity` | as in the file | all | common | The cells (see "Grading and thresholds"). |
| `thresholds.baseline` | object | all | pack | The baseline block. |
| `repeats` | object | all | common | Passes. |
| `repeats.n` | number | all | common | Passes declared: `repeats.n` of `thresholds.json` for the model, `1` for the baseline. |
| `repeats.aggregation`, `repeats.completed` | string, number | model | common | `worst-pass`; passes completed. |
| `calls` | object | all | common | Requests over the whole run. |
| `calls.list`, `calls.model` | object | all | common | `{ ok, failed, retries }`. |
| `log` | object | all | common | The local log, which is not published. |
| `log.file`, `log.sha256` | string | all | common | Its name and SHA-256. |
| `passes[]` | array | all | common | One entry per pass; empty when the run stopped before the first pass. |
| `passes[].index`, `passes[].status`, `passes[].calls` | number, string, object | all with a pass | common | Number, status and requests of the pass. |
| `passes[].reason` | object | a pass not completed | common | Why the pass stopped. |
| `passes[].numbers` | object | a pass not completed | common | Rows so far, missed sanctions among the answers, invalid rows by class. |
| `passes[].decisions[]` | array | all with a pass | pack | Decision rows; for a pass the runner stopped, the rows before the stop. Their keys are below. |
| `passes[].decisionsSha256` | string | all with a pass | common | SHA-256 of the canonical JSON of the decision rows of the pass (see below). |
| `passes[].rubric` | object | completed passes of any run, including a run not completed; a pass not completed with the verdict | common | `{ outcome, gate, why, numbers, intervals, entity }` for a completed pass; `{ outcome: "failed", gate, why }` for a pass not completed with the verdict. `intervals.scope`, below the second level, says the bound describes this SAMPLE book, not the task class. |
| `passes[].grade[]` | array | completed passes of any run, including a run not completed | pack | `{ id, gold, decision, ok, fatal }` per row. |
| `rubric` | object | completed; not-completed with the verdict | common | The result of the run. |
| `rubric.rule` | string | completed; not-completed with the verdict | common | `worst-pass` for a completed run, `not-completed-verdict` for a run not completed with the verdict. |
| `rubric.pass`, `rubric.outcome`, `rubric.gate`, `rubric.why` | number, string | completed; not-completed with the verdict | common | The pass that decided, the outcome, the gate and why. |
| `rubric.numbers`, `rubric.agreement` | object, number | completed | common | Numbers of that pass; share of rows where all passes agreed. |
| `rubric.intervals` | object | completed | common | The bound of the pass with the most missed sanctions; `intervals.scope`, below the second level, says it describes this SAMPLE book, not the task class. |
| `rubric.entity` | object | completed, with `perEntity: true` | pack | Per-entity numbers. |

The same paths, one per line, as the key list prints them:

```receipt-keys
schemaVersion
licence
runId
status
reason.class
reason.status
reason.pass
reason.count
reason.max
reason.fatal
reason.code
reason.row
rerun
kit.sha256sums
packStatus.statusSha256
packStatus.sample
packStatus.review
packStatus.accepted
commitment
commitment.ordinal
commitment.sha256
meta.id
meta.pack
meta.bookVersion
meta.title
meta.banner
meta.fatal
when
runtime.node
run.listTimeoutMs
run.modelTimeoutMs
run.retryMax
run.retryDelayMs
candidate.name
candidate.kind
candidate.family
candidate.notModel
candidate.methods[]
candidate.provider
candidate.apiStyle
candidate.thinking
candidate.params
candidate.returnedModelIds[]
candidate.systemPromptSha256
deviations[]
deviations[].kind
deviations[].ids[]
deviations[].sets[]
deviations[].requested
deviations[].rows[]
toolsAllowed[]
list.vendor
list.endpoint
snapshot.descriptionVersion
snapshot.scope
snapshot.exportDate
snapshot.exportSha256
snapshot.exportFormat
snapshot.server
snapshot.listVersion
snapshot.versionCheck
snapshot.descriptionSha256
input.recipeVersion
input.assemblySha256
input.parties[]
thresholdsSha256
thresholds.thresholdsVersion
thresholds.rubric
thresholds.repeats
thresholds.intervals
thresholds.perEntity
thresholds.baseline
repeats.n
repeats.aggregation
repeats.completed
calls.list
calls.model
log.file
log.sha256
passes[]
passes[].index
passes[].status
passes[].reason
passes[].calls
passes[].decisions[]
passes[].decisionsSha256
passes[].numbers
passes[].rubric
passes[].grade[]
rubric.rule
rubric.pass
rubric.outcome
rubric.gate
rubric.why
rubric.numbers
rubric.intervals
rubric.entity
rubric.agreement
```

A decision row is built from a fixed list of keys, in this order, and never copies the object the candidate returned; no other key appears:

- model: `id`; `decision`: `hit`, `hold`, `clear` or `invalid`; `error`: `{ class, status }`, only when there is one; `matchCalls`: the list calls of the row; `topMatch`: `{ id, score }` of the best-scoring list candidate, when there was one; `returnedModelId`; `params`: the parameters the request bodies carried; `usage`: one entry per model response, when the provider returned it; `responseSha256`: the SHA-256 of the text the decision was parsed from, before any trimming, or `null` without text. The text is in the raw response in the local log, so one line of the log disclosed to a reviewer can be checked against the receipt without the rest of the log;
- baseline: `id`; `decision`; `reason`: the code of the branch taken (see "Assembly"); `matchCalls`; `score`; `fuzzy`: `{ score, jw, lev, tokenSet }`, when computed; `topMatch`: `{ id, score, schema }`, when there was a candidate; `error`, when there is one.

A value that is missing is written as `null`, never left out: `error.class`, `error.status`, `returnedModelId`, `params`, `responseSha256`, `topMatch.id`, `topMatch.score`, `topMatch.schema`, `reason`, `score` and the fields of `fuzzy`.

A receipt holds no reason text of the model, no text of its answers, no arguments of its tool calls, no `caption` and no assembled value of a row.

`decisionsSha256` is the SHA-256, in hex, of the UTF-8 bytes of the canonical JSON of the `decisions` of the pass: the rows exactly as the receipt writes them, in book order. Canonical JSON follows RFC 8785 (JSON Canonicalization Scheme): no whitespace; the keys of every object, at every level, sorted by UTF-16 code units; arrays in their order; numbers and strings as `JSON.stringify` writes them (`-0` gives `0`); `null` kept; `NaN`, `Infinity` or `undefined` are an error, never `null`. Every key of a row is in it, and the grader does not read it. Two runs with the same `decisionsSha256` for a pass made the same decision rows, byte for byte: this is the rule for repeating the baseline (see "Re-executing a run"). The baseline judges one candidate of a list response: the one with the highest server `score`, and among candidates with an equal highest score (`===`) the one with the smallest `id` by UTF-16 code units, candidates without a string `id` after the others; candidates without a numeric `score` take no part, and when none has one it takes the first candidate of the response. The order in which the server lists equal candidates therefore does not change a decision row, as long as the server returns every candidate with the highest score. The baseline computes `score` and `fuzzy` from the assembled name and the caption of that candidate with `+`, `-`, `*`, `/`, `Math.max`, `Math.min` and `Math.floor` only, whose IEEE 754 results are the same on every engine. It folds names with `normalize("NFKD")` and `toLowerCase()`, whose Unicode tables come with the engine, so the byte-for-byte rule holds on the same major Node.js version as `runtime.node` of the receipt.

A model run has one configuration for all its passes: the parameters are the same in the rows of every pass, and any difference is a record in `deviations`.

The schema is fixed by the freeze of the kit. After the freeze, any change to the name, type or meaning of a key, and any new key, gives a new `schemaVersion` and a dated entry in this README; before the freeze the schema changes without a new number. The receipt schema of this pack is meant as the template for the packs after it.

## Re-scoring a published receipt

A published result is checked in two parts. The first needs no network: re-scoring the published receipt gives exactly the published numbers. The second is a reviewer's own run on their own key (see "Re-executing a run"), compared by the gates declared before the run, not byte for byte.

What is needed: this kit, the receipt and the result manifest (see "Result manifest"); no export, no keys, no network.

1. Check the signature of the result manifest with `cosign verify-blob`, outside the kit. The kit checks no signature.
2. `node run.mjs --rescore <receipt> --manifest <result manifest>`

Before any re-scoring, the mode checks that the receipt is the published one and belongs to these files. Each difference prints `RESCORE mismatch class=binding key=<key>`; nothing is re-scored, exit 6.

- With `--manifest`: the SHA-256 of the receipt bytes is the `sha256` of an entry of `receipts` (`MANIFEST match entry=<i>`, counted from 1). This check comes first.
- `kit.sha256sums` is the SHA-256 of the `SHA256SUMS` checked at start.
- `thresholdsSha256` is the SHA-256 of `thresholds.json`, and `thresholds` is its content.
- `packStatus.statusSha256` is the SHA-256 of `pack-status.json`.
- `input.recipeVersion` is `META.recipeVersion`; `input.parties` has the ids of the book in book order with the same `source`, `entity` and `recipe`; the `inputSha256` of every literal row is the digest of its visible row.

`input.assemblySha256` and the `inputSha256` of derived rows need the export: the mode prints `UNVERIFIED input.assemblySha256 entityRows=<n>`, or `UNVERIFIED input` when the book did not assemble. Without `--manifest` it prints `UNVERIFIED manifest` and goes on. A match without `--manifest` shows only that the numbers of the file follow from the rows of the same file; only `--manifest`, with a manifest whose signature was checked, shows that it is the published receipt.

Then the form of the run. Each problem prints `RESCORE mismatch class=shape key=<key>`; nothing is re-scored, exit 6. Pass indexes run from 1. A pass the runner did not stop has one row per book row, in book order, without repeats. A pass the runner stopped has the rows before the stop, no `grade`, a `rubric` only with the verdict, and no pass after it. Every `decision` is `hit`, `hold`, `clear` or `invalid`; a row has only the keys of its mode (see "Receipt schema"), `matchCalls` is a whole number of at least 0, `error` is an object with a string `class` and a `status` that is a number or `null`, and `topMatch` is an object whose `id` is a string or `null`. A pass with `decisions` has a `decisionsSha256` of 64 lower-case hex digits; a pass without has none. `rerun`, `eligible` or `not-eligible`, is present exactly when the run is not completed. A completed run has `repeats.n` passes (model) or one (baseline); a run not completed has no more. The mode is the first part of `runId`.

Then every pass is graded again with the function the runner uses (`scoring.js`), from the book, `thresholds.json` and the `index`, `status`, `reason` and `decisions` of each pass, and compared with the receipt: for each pass `status`, `reason`, `numbers`, `rubric`, `grade` and `decisionsSha256`; for the run `status`, `reason`, `rubric`, `rerun` and `repeats.completed`. Each difference prints `RESCORE mismatch class=value key=<path> published=<value> rescored=<value>` at the first leaf that differs; only numbers, codes and digests are printed, other text shows as `text`. At most 20 such lines are printed, then `… more=<n>`. Fractions (`hitPrecision`, `manualShare`, `agreement`, the bounds) are compared exactly. When every difference is a fraction and the receipt was made on another major Node.js version (`RUNTIME receipt=… here=…`), the class is `float`: the arithmetic of another engine, not another decision. Time, calls, deviations and the log are not compared; the keys of a row the grader does not read change no number and are compared only through `decisionsSha256`.

The line `COMMITMENT` shows the commitment the receipt names; the mode does not check it, and a reviewer compares its digest with the signed `COMMITMENT.json`.

What the runner decided by itself cannot be re-scored: a stop before the first pass (assembly, probe, list version) prints `RUN UNVERIFIED class=<class>`, and a pass the runner stopped prints `PASS <i> UNVERIFIED class=<class>`. The rows of that pass before the stop are still graded again, for its numbers and for a failure already certain.

The output has the form of `--rubric-test` and carries no value of a row: `KIT sha256sums=…`, `THRESHOLDS sha256=…`, `RECEIPT sha256=<SHA-256 of the receipt file> schemaVersion=1 mode=<baseline|model> status=… passes=<k>`, `COMMITMENT receipt=<commitment.sha256|null> ordinal=<commitment.ordinal|null>`, then `MANIFEST sha256=<SHA-256 of the manifest file> receipts=<n>` with `MANIFEST match entry=<i>`, or `UNVERIFIED manifest`, and `RUNTIME receipt=<runtime.node> here=<this Node.js>`; for each pass `DECISIONS pass-<i> rows=… sha256=…`, as the runner prints it, and `RUBRIC pass-<i> …`, with `CI`, `HIT` and `ENTITY` for a completed pass; `AGG worst-pass passes=<k> …`; `RERUN …` when the run is not completed; last `RESCORE match` (exit 0) or `RESCORE mismatch` (exit 6). The `exit=` of a line is the code the run had. Exit codes: 0, 2, 3 and 6 (see "Exit codes").

### What the grader reads

From a decision row: `id`, `decision`, `error.class`, and `error.status` for class `http` (a lost connection, and `rerun`); `matchCalls` and `topMatch.id` only for `hitNoListCall` and `hitEntityMatch`. From the `reason` of a pass and of the run: `class` and, for class `http`, `status` (`rerun`). From the book: `id`, `gold`, `mustHold`, `fatalIfClear`, `entity`. From `thresholds.json`: `rubric`, `repeats`, `intervals`, `perEntity`. Only `decisionsSha256` reads a row whole.

## Result manifest

The published list of results is a result manifest, with its signature bundle next to it. It is published after the runs and is outside `SHA256SUMS`: it names the receipts, and nothing in the kit names it. It has an entry for every receipt published for the result, rehearsals and runs not completed included. The kit reads only:

- `format`: `"result-manifest"`;
- `formatVersion`: `1`;
- `receipts`: a non-empty array of objects, each with `file`, a relative path `runs/<runId>.json`, and `sha256`, 64 lower-case hex digits; no `sha256` appears twice.

The kit does not read or check any other key. `--rescore` checks only that the given receipt is listed; `cosign` checks the signature, outside the kit.

## Re-executing a run

The frozen kit refuses an export whose SHA-256 is not `exportSha256`. With your own copy of the same export:

1. `--assemble`: `sha256=` in the line `ASSEMBLY` is `input.assemblySha256` of the receipt, and the digest of each `ROW` is its `input.parties[].inputSha256`.
2. `--baseline` on the server described in `snapshot.json` (the same software, version and parameters, its index built from this export) repeats the decision rows of the published baseline byte for byte: the line `DECISIONS pass-1` equals `passes[0].decisionsSha256` of the published receipt. The same outcome with another digest is not a repetition. This holds on the same major Node.js version as `runtime.node` of the receipt: the baseline folds names with `normalize("NFKD")` and `toLowerCase()`, whose Unicode tables come with the engine. The kit fixes the export and the software, version and parameters of the server, not its search index. Among candidates with an equal highest score the baseline takes the one with the smallest `id` (see "Receipt schema"), so another build of the index that lists them in another order gives the same rows; this holds as long as the server returns every candidate with the highest score, which a response where every returned candidate has the same highest score does not show.
3. `--model` on your own key, compared by the rule declared before the run.

A run on another export does not re-execute this result: when an entity has left the list, the assembly stops with `missing-entity`.

## Pre-run commitment check

The pre-run commitment is `COMMITMENT.md` and `COMMITMENT.json` next to the kit. `node run.mjs --freeze-check` checks it against the files of the kit, after the digest check and without keys or network. Each finding prints `FREEZE <file>: <key>: <what is wrong>`; the last line is `FREEZE ok ordinal=<n> sha256=<SHA-256 of COMMITMENT.json>` (exit 0) or `FREEZE failed` (exit 2). It checks that:

- `snapshot.json` is complete, `thresholds.json` complete and valid, `pack-status.json` complete and accepting the `data.js` of the kit;
- both commitment files exist, `COMMITMENT.json` is a JSON object, and neither file contains `TBD`;
- `ordinal` is a whole number of at least 1, and `prose.sha256` is the SHA-256 of `COMMITMENT.md`;
- `kit.sha256sums` is the SHA-256 of `SHA256SUMS`, and `kit.files` lists exactly its lines, with the same paths and digests; every digest of `kit.files` appears in `COMMITMENT.md`;
- `book.sha256`, `list.descriptionSha256`, `thresholds.sha256` and `candidate.systemPromptSha256` are the SHA-256 of `data.js`, `snapshot.json`, `thresholds.json` and `system-prompt.txt`;
- `thresholds.values` and `list.snapshot` are the content of `thresholds.json` and `snapshot.json`; `book.sample`, `book.review`, `book.accepted.by`, `book.accepted.date` and `book.sha256` are `sample`, `review`, `accepted.by`, `accepted.date` and `accepted.bookSha256` of `pack-status.json`; `candidate.passes` is `repeats.n`.

`--model` runs only when these checks pass and the settings in force are those of the commitment: `CANDIDATE_MODEL` is `candidate.model`, `CANDIDATE_API_STYLE` `candidate.apiStyle`, `CANDIDATE_THINKING` `candidate.thinking`, `CANDIDATE_MAX_TOKENS` `candidate.maxTokens`, the provider recorded in the receipt `candidate.provider`, `CANDIDATE_TEMPERATURE` unset when `candidate.temperature` is `null`, and the `LIST_TIMEOUT_MS`, `MODEL_TIMEOUT_MS` and `RETRY_MAX` in force are `run.listTimeoutMs`, `run.modelTimeoutMs` and `run.retryMax`. Otherwise it exits 2 before any network call and before `runs/`, naming the variables that differ, never their values. The model provider's address is in neither. `--model-ping` and `--baseline` do not need a commitment. Every receipt of `--baseline` and `--model` names the commitment it ran under in `commitment`, or `null`.

## List snapshot

`LIST_BASE_URL` (http or https, no default) is the base address of the `/match` server; requests go to `<LIST_BASE_URL>/match/<scope>`. Receipts record only the path `/match/<scope>`, never the address.

`snapshot.json` describes the dated export behind that server. `--baseline` and the model sit refuse to start unless every field is set (`server.params` may be `{}`):

- `descriptionVersion`: format of this file; `1`.
- `scope`: dataset of the export; the dataset used for `/match`.
- `exportDate`, `exportSha256`: date and SHA-256 of the export file.
- `exportFormat`: version of the export format.
- `server`: `software` and `version` of the local matching server and its `params` (an object). Do not put addresses or secrets here: the block is copied into receipts.
- `listVersion`: the list version the server serves.
- `versionCheck`: `"response"` or `"description"`. With `"response"`, every `/match` response must carry a version equal to `listVersion`; with `"description"`, the server serves no version, `listVersion` is taken from this file, and a response that does carry a different version still stops the run.

A missing or different version stops the run without a verdict (not completed, exit 4). `etag` and `last-modified` are not read as a version: they describe the response, not the dataset.

Both receipts carry a `snapshot` block: the fields above and `descriptionSha256` (SHA-256 of the bytes of `snapshot.json`); `versionCheck` says whether the version came from the responses or from this file. Baseline and model check against the same `listVersion` from the same file.

## Auth

`OPENSANCTIONS_API_KEY` is required and sent only when the host of `LIST_BASE_URL` is the hosted OpenSanctions API (`api.opensanctions.org`); it is then sent as `Authorization: ApiKey …` (https://www.opensanctions.org/docs/api/authentication/). No other host receives an authorization header, even when the key is set.

## Review status

The review of this pack was internal: no independent review has taken place. We say so here so that no reader has to infer it. OpenSanctions is the list vendor, not a reviewer. If the pack owner later names an external reviewer, the review is published as a separate dated record, not as an edit of the frozen files, and `review` in `pack-status.json` changes only after a review has taken place, in a new version of the kit. An external reviewer is a party outside the project who discloses their ties and stands aside wherever a tie exists.

## Licence

- **Code.** Every file of the kit except `data.js` and the two licence texts (`LICENSE`, `LICENSE-BOOK`) is under the Apache License 2.0 (`LICENSE`). A changed copy carries a notice that it was changed, so that a changed runner is not passed off as this one.
- **Book.** `data.js` is under CC BY-NC 4.0 (`LICENSE-BOOK`; https://creativecommons.org/licenses/by-nc/4.0/), the licence of the list its rows are derived from. Use is non-commercial. The code licence does not cover the book, and the book licence does not cover the code.
- **Receipts.** Receipts of `--baseline` and `--model`, completed or not, rehearsals and every rerun, are under CC BY-NC 4.0 (`LICENSE-BOOK`) with the attribution of the book, and say so in their key `licence`: they carry entity ids of the list (`input`, `topMatch.id`).
- **Attribution.** The list is made by OpenSanctions (https://www.opensanctions.org/). The dataset is the one named by `scope` in `snapshot.json` (https://www.opensanctions.org/datasets/<scope>/), at the export date and list version given there, under CC BY-NC 4.0. Changes: a row derived from an entity is the entity id and a variant recipe, not a record of the list; the runner builds the variant from the export at run time; the export itself is not distributed with the kit.
