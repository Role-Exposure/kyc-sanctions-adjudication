# Verifying P02-PUBLIC

**Pack `kyc.sanctions-adjudication.v1` · surface P02-PUBLIC · commitment No. 2 · Role Exposure**

This file says how to check the published P02 result without taking our word for it: which file,
which command, what you should see and what a failure means. It is published with the result
manifest, after the runs. It is not signed and is outside `SHA256SUMS`. Every expected value
comes from a signed file: `COMMITMENT.json` and the files it pins by digest, the description of
the export, the result manifest and the receipts it lists. Where this file and `COMMITMENT.md`
differ, `COMMITMENT.md` holds. The order of the checks follows and extends `COMMITMENT.md`,
section 14.

Report each check as PASS, SKIP or FAIL, and give a reason for every SKIP. A check you could not
run is a SKIP, never a PASS.

## 1. What you need

Published files of this pack:

- the frozen kit: the 26 files named in `SHA256SUMS`, and `SHA256SUMS`;
- `COMMITMENT.md` and `COMMITMENT.json`, with the signature bundle `COMMITMENT.json.sigstore.json`
  and the timestamp token `COMMITMENT.json.tsr`;
- `tsa.crt` and `cacert.pem`, the certificates of the timestamp service, as published;
- `snapshot-description.json`, the description of the export, with its bundle
  `snapshot-description.json.sigstore.json` and its token `snapshot-description.tsr`, published
  in `https://github.com/Role-Exposure/kyc-sanctions-adjudication`
  (`list.publishedDescription.location` in `COMMITMENT.json`);
- `offline.yml`, the manifest of the matching server;
- the result manifest and its bundle;
- every receipt the result manifest lists, at the path it gives (`runs/<runId>.json`).

From the repository of the first pack, `https://github.com/Role-Exposure/harbor-ledger-demo`:
`MANIFEST.json` and its bundle `MANIFEST.json.sigstore`.

If a file is missing, every check that needs it is a FAIL. Name the file.

Tools: `sha256sum` (on macOS `shasum -a 256`), `jq`, `git`, `cosign` 3.1.3 or newer (on 2.x,
2.6.5 or newer: GHSA-fx35-mq7g-6g98),
`openssl` with the `ts` command, GNU `date` (on macOS `gdate`), `curl`. Node.js only for
sections 7 and 11, of the major version that section names.

Sections 2 to 10 need no network beyond downloading the files and the two certificates of the
timestamp service; whether `cosign` fetches the Sigstore trust root depends on its version and
setup. Section 7 runs kit code without network. Section 11 is your own run.

The blocks are written for bash. Paste each block whole into one bash session, in the order of
this file: later blocks use the names that earlier ones set. A block that needs such names checks
them first, inside `{ ... }`, so that a name that is not set stops the whole block, in an
interactive shell as well. These checks see only whether a name is set, not where its value came
from: a name left by an earlier check in the same shell passes them. Begin each new check in a
new shell.

Run the commands from the folder that holds the published files, with the receipts under `runs/`
and a full clone, not a shallow one, of the repository of the first pack in `harbor-ledger-demo`,
checked out at the commit the commitment names:

```bash
git clone https://github.com/Role-Exposure/harbor-ledger-demo
git -C harbor-ledger-demo checkout --detach "$(jq -r '.numbering.first.commit' COMMITMENT.json)"
```

Set the names once:

```bash
RM=RESULT-MANIFEST.json                        # the result manifest
RM_BUNDLE=RESULT-MANIFEST.json.sigstore.json   # its bundle
P01=harbor-ledger-demo                         # the clone, at numbering.first.commit
ISSUER=https://github.com/login/oauth
S=$(sha256sum SHA256SUMS | cut -d' ' -f1)
C=$(sha256sum COMMITMENT.json | cut -d' ' -f1)
T=$(jq -r '.verificationMaterial.tlogEntries[0].integratedTime' COMMITMENT.json.sigstore.json)
CLOSED=$(jq -c '[.priorChecks[] | select(.kind == "baseline-rehearsal" or .kind == "baseline-attempt")
  | .receiptSha256]' COMMITMENT.json)
```

`S` is the SHA-256 of `SHA256SUMS`, `C` that of `COMMITMENT.json`, `T` the time of the
transparency log entry of the commitment, in Unix seconds, and `CLOSED` the SHA-256 of the three
closed receipts that the commitment names. Each counts only once the check that covers it passes.

## 2. Digests of the kit and of the commitment

First, by outside means and before any code of the kit runs:

```bash
sha256sum -c SHA256SUMS; echo "exit=$?"
echo "$S"; jq -r '.kit.sha256sums' COMMITMENT.json
jq -r '.kit.files[] | "\(.sha256)  \(.path)"' COMMITMENT.json | diff - SHA256SUMS; echo "diff=$?"
sha256sum COMMITMENT.md | cut -d' ' -f1; jq -r '.prose.sha256' COMMITMENT.json
```

Expected: 26 lines `OK` and `exit=0`; the next two lines are the same digest,
`4587667f28bc792cf4f5f4f73bd9ffecf6ff51f577dfc02dcf0459aa0f55948c`; `diff` prints nothing and
`diff=0`; the last two lines are the same digest. `COMMITMENT.json` carries the SHA-256 of
`COMMITMENT.md`, so its signature covers both files.

`SHA256SUMS` names every file of the kit except itself. The commitment files, this file, the
result manifest, the bundles, the tokens and the receipts are outside it: they name the kit, and
nothing in the kit names them. The digest check of the runner reads only the files that
`SHA256SUMS` names, so other files in the folder do not change it. `* -text` in `.gitattributes`
keeps the bytes as they are, so a clone hashes the same as a download.

Failure: a `FAILED` line, or a digest or line that differs, means these are not the frozen bytes
or not the signed prose. Stop: nothing below holds for this copy. Report the file.

These links count once section 3 shows that `COMMITMENT.json` is signed.

## 3. Signatures

Four files are signed keyless through Sigstore, by one identity, with the issuer
`https://github.com/login/oauth`:

| File | Bundle |
|---|---|
| `MANIFEST.json` of the first pack | `MANIFEST.json.sigstore` |
| `snapshot-description.json` | `snapshot-description.json.sigstore.json` |
| `COMMITMENT.json` | `COMMITMENT.json.sigstore.json` |
| the result manifest | its bundle |

The commitment names the identity as the one in the certificate of `MANIFEST.json.sigstore`
(`COMMITMENT.md`, section 14). Read it from there:

```bash
ID=$(jq -r '.verificationMaterial.certificate.rawBytes' "$P01/MANIFEST.json.sigstore" | base64 -d \
  | openssl x509 -inform DER -noout -ext subjectAltName | sed -n 's/^ *email://p')
echo "$ID"
```

Expected: one email address.

```bash
cosign verify-blob "$P01/MANIFEST.json" --bundle "$P01/MANIFEST.json.sigstore" \
  --certificate-identity "$ID" --certificate-oidc-issuer "$ISSUER"; echo "exit=$?"
cosign verify-blob snapshot-description.json --bundle snapshot-description.json.sigstore.json \
  --certificate-identity "$ID" --certificate-oidc-issuer "$ISSUER"; echo "exit=$?"
cosign verify-blob COMMITMENT.json --bundle COMMITMENT.json.sigstore.json \
  --certificate-identity "$ID" --certificate-oidc-issuer "$ISSUER"; echo "exit=$?"
cosign verify-blob "$RM" --bundle "$RM_BUNDLE" \
  --certificate-identity "$ID" --certificate-oidc-issuer "$ISSUER"; echo "exit=$?"
```

Expected: `Verified OK` and `exit=0` four times. `cosign` checks the signature over the bytes of
the file, the certificate chain to the Sigstore root, the inclusion in the transparency log and
that the certificate names the identity and the issuer passed.

The identity is read from the bundle of the first pack, so the first command shows only that this
bundle verifies. What the four together show is that the description, the commitment and the
result manifest were signed by the identity that signed the manifest of the first pack. They do
not show who that is (section 12).

**Form and order of the entries.** The entry of each signature is
`verificationMaterial.tlogEntries[0]` of its bundle; its `logIndex` is the one at that level, not
`inclusionProof.logIndex`.

```bash
for b in "$P01/MANIFEST.json.sigstore" snapshot-description.json.sigstore.json \
         COMMITMENT.json.sigstore.json "$RM_BUNDLE"; do
  jq -r '[.mediaType, (.verificationMaterial.tlogEntries[0]
           | .kindVersion.kind, .kindVersion.version, .logIndex, .integratedTime)] | @tsv' "$b"
done | awk -F'\t' '{ print }
  NR > 1 && ($4 + 0 <= i || $5 + 0 < t) { bad = 1 }
  { i = $4 + 0; t = $5 + 0 }
  END { print (bad ? "order FAILED" : "order ok") }'
jq -r '.list.publishedDescription | .rekorLogIndex, .sha256' COMMITMENT.json
sha256sum snapshot-description.json | cut -d' ' -f1
```

Expected:

- four lines, in the order of the table above, each with the media type
  `application/vnd.dev.sigstore.bundle.v0.3+json`, the entry kind `hashedrekord` and version
  `0.0.1`. The commitment names the media type for the first three bundles and the entry kind for
  its own; for the bundle of the result manifest both go beyond it, and another form there is a
  finding to report, not a broken promise;
- `logIndex` (fourth column) and `integratedTime` (fifth, Unix seconds) grow from line to line,
  and the last line is `order ok`;
- the second line has `logIndex` 3216813350, the number the commitment gives, and the SHA-256 of
  `snapshot-description.json` is the one the commitment gives,
  `7163e52d52e4cacd227d06e8330d5ef0dcf8a278dc958ef9da613cc2788a3006`.

**Number of this commitment.** `ordinal` is in the signed bytes:

```bash
jq -r '.ordinal' COMMITMENT.json
jq -r '.numbering.first | .commit, .commitmentSha256' COMMITMENT.json
git -C "$P01" show "$(jq -r '.numbering.first.commit' COMMITMENT.json)":COMMITMENT.md | sha256sum
```

Expected: `2`; the `COMMITMENT.md` of the first pack at that commit has the SHA-256 the
commitment gives. The public list of commitments named in `COMMITMENT.md`, section 1,
`https://github.com/Role-Exposure/kyc-sanctions-adjudication/blob/main/COMMITMENTS.md`
(`numbering.first.publicList`), shows No. 1, numbered after the fact and marked so, and No. 2,
with no gap.

Failure: a signature that does not verify, another identity or issuer, a bundle of another form,
or entries in another order. Rely on nothing that bundle covers. Report the file and the numbers
as you read them.

## 4. Timestamps

Two files carry an RFC 3161 token from Free TSA (freetsa.org): `COMMITMENT.json`
(`COMMITMENT.json.tsr`) and `snapshot-description.json` (`snapshot-description.tsr`). Both
tokens are part of the condition on which the public runs start: both checks below give
`Verification: OK` (`COMMITMENT.md`, section 14). That the token of the commitment was obtained
before the first public attempt is checked in section 10, once the attempts are known. The
commitment promises no token on the result manifest. If one is published, check it as below,
with its file; if none is, that is not a FAIL.

Take both certificates from the service itself, into a new empty folder, and compare them with
the published copies and with the commitment:

```bash
TSA=$(mktemp -d)
curl -fsS -o "$TSA/tsa.crt" https://freetsa.org/files/tsa.crt
curl -fsS -o "$TSA/cacert.pem" https://freetsa.org/files/cacert.pem
sha256sum "$TSA/tsa.crt" tsa.crt "$TSA/cacert.pem" cacert.pem
jq -r '.signing.timestampFiles | .certificate.sha256, .root.sha256' COMMITMENT.json
openssl x509 -in "$TSA/tsa.crt" -noout -fingerprint -sha256
openssl x509 -in "$TSA/cacert.pem" -noout -fingerprint -sha256
jq -r '.signing.timestampFiles | .certificate.fingerprintSha256, .root.fingerprintSha256' COMMITMENT.json
openssl x509 -in "$TSA/tsa.crt" -noout -enddate
```

Expected: the copy of the service and the published copy of each certificate have the same
SHA-256, the one in the commitment: `8bfb0305bb64e2571ca507552ef3245cb1c2fee8728e0ff8689225081ea13467`
for `tsa.crt`, `2151b61137ffa86bf664691ba67e7da0b19f98c758e3d228d5d8ebf27e044438` for
`cacert.pem`. If the service has since written a file in another encoding, compare by the
fingerprint: the value after `Fingerprint=` equals the one in the commitment. `tsa.crt` ends on
2040-02-02.

Verify each token over its file, with the certificates of the service:

```bash
openssl ts -verify -data COMMITMENT.json -in COMMITMENT.json.tsr \
  -CAfile "$TSA/cacert.pem" -untrusted "$TSA/tsa.crt"
openssl ts -verify -data snapshot-description.json -in snapshot-description.tsr \
  -CAfile "$TSA/cacert.pem" -untrusted "$TSA/tsa.crt"
```

Expected: `Verification: OK` for each. Pass `-untrusted` always, as the commitment gives the
command. After 2040-02-02 add `-attime <time of the token in Unix seconds>`.

Both tokens carry two certificates: the one that signed them, `tsa.crt`, and the root,
`cacert.pem`:

```bash
for t in COMMITMENT.json.tsr snapshot-description.tsr; do
  openssl ts -reply -in "$t" -token_out | openssl pkcs7 -inform DER -print_certs \
    | awk '/-----BEGIN/ { c = "" } { c = c $0 "\n" }
           /-----END/ { printf "%s", c | "openssl x509 -noout -subject -fingerprint -sha256"
                        close("openssl x509 -noout -subject -fingerprint -sha256") }'
done
```

Expected: for each token, two certificates, with the fingerprints the commitment gives
(`jq -r '.signing.timestampFiles | .certificate.fingerprintSha256, .root.fingerprintSha256' COMMITMENT.json`):
`32:E8:41:A9:5C:C1:16:41:01:FF:DE:41:29:8E:F2:FC:75:C1:C4:37:2E:F0:95:E8:8A:6B:BD:47:DF:B1:91:FC`
of `tsa.crt` and
`A6:37:9E:7C:EC:C0:5F:AA:3C:BF:07:60:13:D7:45:E3:27:BB:BA:A3:8C:0B:9A:F2:24:69:D4:70:1D:18:AA:BC`
of `cacert.pem`, and no other.

Times:

```bash
for t in snapshot-description.tsr COMMITMENT.json.tsr; do
  openssl ts -reply -in "$t" -text | sed -n 's/^Time stamp: //p'
done
date -u -d "$(openssl ts -reply -in snapshot-description.tsr -text | sed -n 's/^Time stamp: //p')" +%s
echo "$T"
```

Expected: the token of the description is of 2026-09-30 13:26:41 UTC
(`list.publishedDescription.timestampTime` in the commitment), and its time in Unix seconds is
smaller than `T`: the description was timestamped before the commitment was logged.

Failure: any other output. The token is not over these bytes or not from this service.

## 5. Description of the export and manifest of the server

The description signed in section 3 and timestamped in section 4 must describe the export that
the frozen `snapshot.json` names:

```bash
jq '{exportSha256, exportVersion, exportDate, scope, entityCount}' snapshot-description.json
jq -n --slurpfile d snapshot-description.json --slurpfile s snapshot.json '$d[0] as $d | $s[0] as $s | {
  exportSha256: ($d.exportSha256 == $s.exportSha256),
  exportVersion: ($d.exportVersion == $s.listVersion),
  exportDate: ($d.exportDate == $s.exportDate),
  scope: ($d.scope == $s.scope),
  entityCount: (($d.entityCount | tostring) == "72236") }'
```

Expected: every value `true`. The description gives the export SHA-256 of `snapshot.json`,
`81bc254601ee9c0685ad7f8cccdf8a83169464cb4eec957a47280a6854428bda`; as `exportVersion`, the
list version `20260909221001-juh`; the export date `2026-09-09T22:10:01`, as the vendor writes
it, without a time zone; the scope `us_ofac_sdn`; and `entityCount` 72236, the number of
documents the commitment reports for every build of the index (`COMMITMENT.md`, sections 5 and
10). Its other keys (`descriptionVersion`, `provider`, `lastChange`, `exportFile`, `exportFormat`, `exportSize`,
`exportSha1Provider`, `indexJsonSha256`, `targetCount`, `downloadedAt`) describe the download
and are not compared.

```bash
sha256sum offline.yml | cut -d' ' -f1
jq -r '.server.params.manifest.sha256' snapshot.json
jq -r '.list.serverManifest.sha256' COMMITMENT.json
```

Expected: three times `464fb195ebccc7e38183c014a1550cd08507e961e8628be1c4de56ee7aca80de`.

What this shows: the description signed before the commitment and the frozen kit name the same
export, and the published manifest of the server is the one the kit names. The kit refuses
another export file when it assembles the rows. It does not see from which export the index of a
server was built (section 12).

## 6. Receipts and the result manifest

Only after section 3 has verified the signature of the result manifest.

The result manifest has, at the top: `format` `"result-manifest"`, `formatVersion` 1,
`commitment` (`ordinal` and `sha256`), `receipts` (`file` and `sha256` of every published receipt,
in the order of their `when`), `attempts` (the names under which the party that executes the runs
keeps each public attempt) and `records` (section 10). The kit reads only `format`,
`formatVersion` and `receipts`.

```bash
jq -r 'keys_unsorted | join(" ")' "$RM"
jq -r '.format, .formatVersion, (.receipts | length), (.attempts | length)' "$RM"
jq -r '.commitment | .ordinal, .sha256' "$RM"; echo "$C"
jq -r '.receipts[] | "\(.sha256)  \(.file)"' "$RM" | sha256sum -c; echo "exit=$?"
jq -r '.receipts[].file' "$RM" | while read -r f; do jq -r '.when' "$f"; done | sort -c \
  && echo "receipts in the order of when"
```

Expected: the line `format formatVersion commitment receipts attempts records`;
`result-manifest`, `1`, the number of receipts and the number of
attempts; the manifest names commitment `2` and the digest `C`; one `OK` line per receipt and
`exit=0`; `receipts in the order of when`.

The three closed receipts, the two baseline rehearsals and the first attempt of the rehearsals,
are listed, under their names, and name no commitment:

```bash
jq -r '.priorChecks[] | select(.kind == "baseline-rehearsal" or .kind == "baseline-attempt")
       | "\(.receiptSha256) \(.runId)"' COMMITMENT.json \
  | while read -r sha id; do
      jq -e --arg s "$sha" --arg f "runs/$id.json" 'any(.receipts[]; .sha256 == $s and .file == $f)' \
        "$RM" > /dev/null && echo "listed $id commitment=$(jq -c '.commitment' "runs/$id.json")" \
        || echo "MISSING $id"
    done
```

Expected: three lines `listed ... commitment=null`.

Every other listed receipt is a receipt of a public attempt. Their files, and every listed
receipt in one table:

```bash
PUBLIC=$(jq -r --argjson cl "$CLOSED" '.receipts[] | select(.sha256 | IN($cl[]) | not) | .file' "$RM")
jq -r '.receipts[] | "\(.sha256) \(.file)"' "$RM" | while read -r sha f; do
  jq -r --arg f "$f" --arg sha "$sha" --arg s "$S" --arg c "$C" --argjson t "$T" --argjson cl "$CLOSED" '
    ($cl | index([$sha])) as $closed | [
    .runId,
    (if $closed then "closed" else "public" end),
    (if $f == "runs/\(.runId).json" then "file=ok" else "file=OTHER" end),
    (if .kit.sha256sums == $s then "kit=ok" else "kit=OTHER" end),
    (if .commitment == null then "commitment=null"
     elif .commitment.ordinal == 2 and .commitment.sha256 == $c then "commitment=this"
     else "commitment=OTHER" end),
    (if $closed then "after=-"
     else "after=\(.when | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601 > $t)" end),
    "status=\(.status)", "rerun=\(.rerun // "-")", "outcome=\(.rubric.outcome // "-")"
  ] | @tsv' "$f"
done | sort
```

Expected:

- `file=ok` and `kit=ok` on every line;
- `commitment=null` on the three closed receipts; `commitment=this` on every public receipt,
  except a public baseline receipt whose copy did not pass the freeze check: it carries
  `commitment=null`, is an attempt, and does not pass the comparison of section 8; no
  `commitment=OTHER`. A public model receipt always names the commitment, since the kit refuses
  `--model` otherwise;
- `after=true` on every public line: the `when` of every public receipt is later than the
  transparency log entry of the commitment. The `when` is written by the clock of the party that
  executes the runs;
- no file `runs/latest.json` or `runs/baseline-latest.json`. The runner writes these copies of the
  last receipt, with the same bytes; they are not published results. A manifest that listed one
  beside its receipt would repeat a `sha256`, and `--rescore` refuses such a manifest.

Failure: a receipt whose digest differs is not the published one; a receipt that is not listed is
not part of the result; a missing closed receipt breaks the condition under which the public runs
could start (`COMMITMENT.md`, section 14).

## 7. Re-scoring

Kit code, without network, keys, export or settings. Only with `--manifest`, and only after
section 3 has verified the signature of the result manifest: the kit checks that the receipt is
listed, not that the manifest is signed.

Make a clean copy of the published kit: the files `SHA256SUMS` names and `SHA256SUMS` itself,
without `runs/` and `.env`:

```bash
W=$(mktemp -d)
while read -r sum f; do cp -- "$f" "$W/"; done < SHA256SUMS
cp SHA256SUMS "$W/"
```

Use Node.js of the same major version as `runtime.node` of the receipt:

```bash
node --version
jq -r '.receipts[].file' "$RM" | while read -r f; do jq -r '"\(.runtime.node) \(.runId)"' "$f"; done
```

Then, for every listed receipt:

```bash
R=$PWD
jq -r '.receipts[].file' "$RM" | while read -r f; do
  echo "== $f"
  ( cd "$W" && env -i PATH="$PATH" node run.mjs --rescore "$R/$f" --manifest "$R/$RM" < /dev/null
    echo "exit=$?" )
done
```

Expected for each receipt, in this order, and `exit=0`:

```text
KIT sha256sums=<S>
THRESHOLDS sha256=cc1ce9f16002415f3961a877134a0b6c34266728e32b9e8f1897853c83a88fa5
RECEIPT sha256=<SHA-256 of the receipt> schemaVersion=1 mode=<baseline|model> status=<completed|not-completed> passes=<k>
COMMITMENT receipt=<commitment.sha256 of the receipt, or null> ordinal=<2, or null>
MANIFEST sha256=<SHA-256 of the result manifest> receipts=<n>
MANIFEST match entry=<i>
RUNTIME receipt=<runtime.node> here=<your Node.js>
UNVERIFIED input.assemblySha256 entityRows=37
```

then, for each pass, its lines, then the summary, then the last line:

```text
DECISIONS pass-<i> rows=<rows> sha256=<decisionsSha256>
RUBRIC pass-<i> status=completed outcome=<outcome> gate=<gate> n=69 missed=<m> hold=<h> hitPrecision=<p> invalid=<v> manualShare=<s> exit=<e>
CI pass-<i> missedRate=[0.0000,<upper>] k=<m> n=25
HIT pass-<i> correct=<hits correct> entityMatch=<hits on the entity> noListCall=<hits without a list call>
ENTITY pass-<i> entities=<entities> withHit=<with a hit> missed=<missed> allHit=<all hit>
AGG worst-pass passes=<k> status=completed outcome=<outcome> gate=<gate> pass=<worst pass> agreement=<share> missedRate=[0.0000,<upper>] k=<missed> n=25 exit=<e>
RESCORE match
```

`COMMITMENT receipt=` is the digest `C` for a public receipt and `null` for the three closed ones;
it is also `null` for a public baseline attempt whose copy did not pass the freeze check, which
does not pass the comparison of section 8.
A completed baseline has one pass, a completed model run three.

For the public baseline and for the three closed receipts, the pass lines carry the figures of
`COMMITMENT.md`, section 9:

```text
DECISIONS pass-1 rows=69 sha256=925ec682edccc0dd8aeaaf80d6e2329dc2db8ed34b05dd97c4a297aefa8fcaf4
RUBRIC pass-1 status=completed outcome=failed gate=missed-sanction n=69 missed=2 hold=11 hitPrecision=0.9130 invalid=0 manualShare=0.2319 exit=5
CI pass-1 missedRate=[0.0000,0.2310] k=2 n=25
HIT pass-1 correct=21 entityMatch=21 noListCall=0
AGG worst-pass passes=1 status=completed outcome=failed gate=missed-sanction pass=1 agreement=1.0000 missedRate=[0.0000,0.2310] k=2 n=25 exit=5
```

with the `ENTITY` line as in the receipt.

A run that is not completed:

- a pass the runner stopped (a list error or the list version) prints, after its `DECISIONS`
  line, `PASS <i> UNVERIFIED class=<class>`, then
  `RUBRIC pass-<i> status=not-completed rows=<rows before the stop> missed=<m> rerun=<eligible|not-eligible> exit=4`;
- a pass left not completed by its invalid rows prints
  `RUBRIC pass-<i> status=not-completed invalid=<n> fatal=<f> missed=<m> rerun=<...> exit=4`;
- a pass whose answered rows already make the failure certain adds
  `outcome=failed gate=<gate>` before `rerun=`, and its `exit=` is 5;
- the summary is `AGG worst-pass passes=<k> status=not-completed pass=<i> rerun=<...> exit=4`, or
  with the verdict `AGG worst-pass passes=<k> status=not-completed outcome=failed gate=<gate> pass=<i> rerun=<...> exit=5`;
- a run stopped before its first pass (row assembly, list probe, list version) has no pass lines
  and no `AGG`: it prints `UNVERIFIED input` in place of `UNVERIFIED input.assemblySha256` when
  the rows did not assemble, and `RUN UNVERIFIED class=<class>`;
- before the last line, `RERUN eligible` or `RERUN not-eligible`.

Each `exit=` is the code the run had, or that pass alone would have had; the mode itself exits
0, 2, 3 or 6. `rerun` is recomputed from the rows and the stops as the receipt gives them, the
error class of each invalid row included, and compared with the receipt, so `RESCORE match` also
confirms it, for those classes; the classes come from the runner (section 12).

| Exit | Meaning |
|---|---|
| 0 | `RESCORE match` |
| 2 | refused, nothing compared: `RESCORE refused reason=manifest` (the manifest cannot be read, is not JSON, or is not of the form the kit reads: `format`, `formatVersion`, a non-empty `receipts` with `file` `runs/<runId>.json` and a `sha256` of 64 lower-case hex digits, none repeated); `reason=json`, `schema` or `shape` for the receipt; or a usage error |
| 3 | the copy is not the frozen kit: a file differs from `SHA256SUMS` |
| 6 | `RESCORE mismatch`, after one line per difference: `RESCORE mismatch class=binding key=manifest` when the receipt is not listed in the manifest (then nothing is re-scored); `class=binding` with another key when the receipt was not made on these files; `class=shape`; `class=value` or `class=float` with the path, the published and the recomputed value |

Failure by class: `binding`, the receipt is not the published one or not made on this kit, its
thresholds, pack status or book; `shape`, rows missing, repeated, out of order or with keys
outside the declared list; `value`, the recomputed figures differ, which is a finding; `float`,
only fractions differ and `RUNTIME` shows another major version of Node.js: repeat with the
version the receipt names.

What re-scoring cannot check, and says so: `UNVERIFIED input.assemblySha256` (rows derived from
entities need the export, section 11), `RUN UNVERIFIED` and `PASS <i> UNVERIFIED` (the stops of the
runner). It shows that the published figures follow from the published decision rows under the
frozen rubric. It does not show that the rows came from the model.

Optional, also kit code: in a copy with `COMMITMENT.md` and `COMMITMENT.json` added,
`env -i PATH="$PATH" node run.mjs --freeze-check` ends with `FREEZE ok ordinal=2 sha256=<C>` and
exit 0. It repeats section 2 from inside the kit and checks more: that `snapshot.json`,
`thresholds.json` and `pack-status.json` are complete, and that the digests and values the
commitment pins (`book`, `list`, `thresholds`, `candidate.systemPromptSha256`,
`candidate.passes`) match `data.js`, `snapshot.json`, `thresholds.json`, `pack-status.json` and
`system-prompt.txt` (README, "Pre-run commitment check").

## 8. The public baseline against the expected result

The public baseline run re-executes the rehearsal `baseline-20261012T194338Z-ff43bb`. Its
comparison passes only for the completed public attempt whose decision rows equal those of the
rehearsal, byte for byte (`COMMITMENT.md`, section 9). There is at most one completed public
baseline attempt: no rerun follows a completed attempt.

```bash
B=$(for f in $PUBLIC; do
  jq -r --arg f "$f" 'select((.runId | startswith("baseline-")) and .status == "completed") | $f' "$f"
done); echo "$B"
jq -r '.runs[] | select(.mode == "baseline") | .expected.decisionsSha256' COMMITMENT.json
jq -r '.passes[0].decisionsSha256, .commitment.ordinal, .commitment.sha256, .kit.sha256sums' "$B"
jq -c '.run' "$B"
jq -n --slurpfile k COMMITMENT.json --slurpfile r "$B" --arg c "$C" --arg s "$S" '
  $k[0] as $m | $r[0]
  | (.passes[0].decisionsSha256 == ($m.runs[] | select(.mode == "baseline") | .expected.decisionsSha256))
    and .commitment.ordinal == $m.ordinal and .commitment.sha256 == $c
    and .kit.sha256sums == $s and .kit.sha256sums == $m.kit.sha256sums
    and .run == ($m.run | {listTimeoutMs, modelTimeoutMs, retryMax, retryDelayMs})'
```

Expected: one file; the expected digest and `passes[0].decisionsSha256` of the receipt are both
`925ec682edccc0dd8aeaaf80d6e2329dc2db8ed34b05dd97c4a297aefa8fcaf4`; `2`, `C` and `S`;
`{"listTimeoutMs":30000,"modelTimeoutMs":120000,"retryMax":2,"retryDelayMs":1000}`; the last line
`true`.

The outcome `failed`, gate `missed-sanction`, with `exit=5` in the lines of section 7, is
expected: the baseline misses two sanctions of the book, and the rehearsals showed it before the
commitment. The comparison is by the rows, not by the outcome: the same outcome with another
digest is a divergence.

Failure: no completed public attempt, or `false`. Then the baseline did not pass the comparison,
and there is no model run under this commitment (section 10). Any departure is a finding; it is
published as one, and the divergence is stated before any explanation of it.

## 9. The model receipt

For the completed public model attempt (a model attempt not completed follows below):

```bash
M=$(for f in $PUBLIC; do
  jq -r --arg f "$f" 'select((.runId | startswith("model-")) and .status == "completed") | $f' "$f"
done); echo "$M"
jq '{candidate, deviations, toolsAllowed, repeats, run}' "$M"
jq -n --slurpfile k COMMITMENT.json --slurpfile r "$M" '
  $k[0] as $m | $r[0]
  | .candidate.name == $m.candidate.model
    and .candidate.provider == $m.candidate.provider
    and .candidate.apiStyle == $m.candidate.apiStyle
    and .candidate.thinking == $m.candidate.thinking
    and .candidate.params == {max_tokens: $m.candidate.maxTokens, thinking: {type: "disabled"}}
    and .candidate.systemPromptSha256 == $m.candidate.systemPromptSha256
    and .candidate.returnedModelIds == [$m.candidate.model]
    and .toolsAllowed == $m.candidate.tools
    and .deviations == []
    and .repeats == {n: $m.candidate.passes, aggregation: $m.thresholds.values.repeats.aggregation, completed: $m.candidate.passes}
    and .run == ($m.run | {listTimeoutMs, modelTimeoutMs, retryMax, retryDelayMs})'
```

Expected, and the last line `true`:

- `candidate.name` is `claude-sonnet-5`, the `CANDIDATE_MODEL` of the run, which is `model` of
  the commitment (the commitment's own `candidate.name` is the display name, Claude Sonnet 5);
- `candidate.provider` is `anthropic`, the API style, since `CANDIDATE_PROVIDER` is not set;
  `candidate.apiStyle` `anthropic`; `candidate.thinking` `disabled`;
- `candidate.params` is `{"max_tokens":1024,"thinking":{"type":"disabled"}}`, without
  `temperature`;
- `candidate.systemPromptSha256` is the SHA-256 of `system-prompt.txt`,
  `edc29e1bb08bfd1c938d43898b6031179d314d10e6c5c46f5ad1060e89da94c0`;
- `candidate.returnedModelIds` is `["claude-sonnet-5"]`, and `deviations` is `[]`: one model id
  returned, the requested one, and one set of parameters in every row;
- `toolsAllowed` is `["opensanctions.match"]`; `repeats` is `{"n":3,"aggregation":"worst-pass","completed":3}`;
- `run` is `{"listTimeoutMs":30000,"modelTimeoutMs":120000,"retryMax":2,"retryDelayMs":1000}`:
  `LIST_TIMEOUT_MS`, `MODEL_TIMEOUT_MS` and `RETRY_MAX` were not set.

The kit refuses `--model` before any network call when the commitment fails its freeze check or
when the model, API style, thinking, token limit, provider, temperature or the three settings of
`run` differ from `COMMITMENT.json`. The receipt records the parameters the runner built, not what
reached the provider. Neither the commitment nor the receipt names the address of the provider.

Failure: `false`, or a non-empty `deviations`. Report the keys.

Every public model attempt not completed:

```bash
for f in $PUBLIC; do
  jq -r --arg f "$f" 'select((.runId | startswith("model-")) and .status == "not-completed") | $f' "$f"
done | while read -r file; do
  jq -n -r --slurpfile k COMMITMENT.json --slurpfile r "$file" --arg file "$file" '
    $k[0] as $c | $r[0]
    | "\($file) \(.candidate.name == $c.candidate.model
        and .candidate.provider == $c.candidate.provider
        and .candidate.apiStyle == $c.candidate.apiStyle
        and .candidate.thinking == $c.candidate.thinking
        and .candidate.params == {max_tokens: $c.candidate.maxTokens, thinking: {type: "disabled"}}
        and .candidate.systemPromptSha256 == $c.candidate.systemPromptSha256
        and (.candidate.returnedModelIds == [] or .candidate.returnedModelIds == [$c.candidate.model])
        and .toolsAllowed == $c.candidate.tools
        and .deviations == []
        and .repeats.n == $c.candidate.passes and .repeats.completed < $c.candidate.passes
        and .run == ($c.run | {listTimeoutMs, modelTimeoutMs, retryMax, retryDelayMs}))"'
done
```

Expected: `true` after each file. The settings are those of the completed attempt;
`candidate.returnedModelIds` is `[]` when no request to the model succeeded, as when the run
stopped before its first pass (row assembly, the list probe or the list version) or every request
to the model failed, and `["claude-sonnet-5"]` otherwise; `repeats.completed` counts the
completed passes, fewer than 3.

## 10. Attempts and the records of the result manifest

The kit does not link or count attempts. The rules of `COMMITMENT.md`, section 8, are checked on
the receipts and on the records of the result manifest.

**Rules.**

- An attempt is a public `--baseline` or `--model` run: a listed receipt other than the three
  closed ones, a withheld receipt, or a run that left no receipt. A start refused before any
  network call writes nothing and is not an attempt; after the signature it has a `refused`
  record.
- A rerun follows only an attempt not completed whose receipt has `rerun: "eligible"`. The kit
  sets `not-eligible` for a model attempt with the verdict `failed`; a baseline attempt with that
  verdict can still be `eligible`. No rerun follows a completed attempt, a run without a receipt or
  a withheld receipt.
- At most two reruns per mode, so at most three attempts. Attempts start after the signature of
  the commitment and before the signature of the result manifest; a further run is under a new
  commitment, and its receipts name that one.
- Attempt k+1 starts after the receipt of attempt k is written.
- The model runs only after a baseline attempt that passed section 8, on the same build of the
  index. If the baseline receipt is withheld, or no baseline attempt passes, there is no model
  run.
- The result over the attempts of a mode: `failed` if any attempt has the verdict `failed`;
  otherwise, if the last attempt completed, the worst completed pass of all attempts; otherwise
  not completed.

**Records.** Each record of `records` has:

- `date`, UTC, in one of two forms, `YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DDTHH:MM:SS.fffZ` with
  exactly three digits after the point; the manifest holds no other form, and a date in another
  form, or one that is not a date of the calendar, as 2026-02-30, is a finding of the check of
  dates below;
- `kind`;
- `what`, a phrase with pairs `key=value`;
- `phase`: `before-completion` (from 2026-10-13T12:36:00Z, after the last closed check of
  `COMMITMENT.md`, section 10, until the completion of the commitment, starts of `--check` and
  `--freeze-check` on a text that was changed afterwards included), `before-signature` (from the
  completion of the commitment to its signature) or `after-signature`. The only record dated
  earlier than 2026-10-13T12:36:00Z is the `index-build` of the build of the public runs, dated
  2026-10-12T21:36:53Z, the time of its check, which has its own window (`COMMITMENT.md`,
  section 14);
- `machine`: `stand`, the machine of the runs, or `other`.

The reader compares kinds and pairs.

| `kind` | Words and pairs in `what` | What it records |
|---|---|---|
| `kit-start`, `kit-start-result` | the mode, as `--check`; in the result, `result=` and, where given, `exit=` | a start of `--check`, `--freeze-check` or `--rescore <file>`, or the start of an attempt, as `--baseline (public attempt N, dir public-baseline-N)`; its result: `result=ok` or `differs` for `--check`, `result=ok` or `failed` for `--freeze-check`, `result=match` or `mismatch` for `--rescore` |
| `isolation-check`, `isolation-check-result` | a label in words, as `before the public runs` or `before public model attempt N`; in the result, `result=confirmed` or `not-confirmed`, `exit=` | a run of the isolation check of the stand, which requests the list of models of the provider through the proxy without a key and without a row of the book |
| `index-check`, `index-check-result` | `before` or `after` what it checks; in the result, `result=ok` or `differs`, `index=`, `documents=`, `created=`, `catalog=version=...,index_version=...,index_current=...` | a check of the index, with `/catalog` and `/readyz` of the server |
| `index-build` | the build; where given, `result=` | a build of the index: the build of the public runs, and each build after it; written by hand |
| `attempt-result` | `attempt <name> result`, `runId=`, `receipt=runs/...`, `sha256=`, `status=`, `exit=`, `checksFailed=`, `withheld=yes` or `no` | a public attempt with a receipt, a withheld one included |
| `attempt` | `attempt <name> interrupted` or `attempt <name> without receipt`, `runId=` (or `none`), `logSha256=` (or `none`) | a public attempt whose run was cut off after the start, or that left no receipt |
| `receipt-withheld` | `runId=`, `sha256=`, `keyPaths=` | a receipt that failed the leak check: the key paths, without the values |
| `refused` | `refused before any network call`, `exit N`, `dir refused-...` | a start refused before any network call: not a run, no attempt, nothing written |
| `receipt-check` | `leak <file>` | a run of the leak check of a receipt against its log |
| `re-creation` | `re-creation of the two runner containers of the stand (new copy of the kit; the matching server and its index are not touched)` | a re-creation of the two containers that run the kit, for a new copy of it; the matching server and its index are not touched |
| `provider-request` | the request, `key=yes` or `no`; where given, `result=` | a request to the API of the model provider outside the kit, made from the machine of the runs or with the key used by the public runs, other than a run of the isolation check; written by hand |
| `server-query` | the query | a query to the matching server outside the runs and outside `index-check`, written by hand |
| `other` | | a record of no kind above |

Only four kinds have a record of their result with the suffix `-result`: `kit-start`,
`isolation-check`, `index-check` and `attempt`. A `provider-request` or an `index-build` that
gives `result=` keeps its own kind. The manifest holds no kind outside this table.

The name of an attempt is `public-<mode>-<N>`. An attempt whose run was cut off and whose
receipt was then found on disk has two records: `interrupted`, and later its `attempt-result`.

The records cover the time from 2026-10-13T12:36:00Z, after the last closed check of
`COMMITMENT.md`, section 10, until the result manifest is signed: every start of a mode of the
kit, except the starts of `--rescore` against the result manifest itself, every refusal of
`--baseline` or `--model` before any network call after the signature, every check of the index,
every run of the isolation check, every re-creation of a container of the stand, every query to
the matching server outside the runs and every request to the API of the model provider outside
the kit made from the machine of the runs or with the key used by the public runs. Builds of the
index are recorded from the build of the public runs on.
What happens after the result manifest is signed is not in it: starts of `--check`,
`--freeze-check`, `--list-ping` or `--rescore`, such as a re-scoring of the published receipts,
and checks of the index or of the isolation of the stand send no row of the book, write no
receipt and do not change the result. After the result manifest is signed, the party that
executes the runs starts no `--baseline` or `--model` run on a copy that carries this
`COMMITMENT.json`.

This section uses the names of sections 1 and 6; each block checks the names it needs first
(section 1). The pairs are read with one helper, `PAIR`. `TM` is the time of the entry of the
result manifest, `W0` the start of the window of the records and `I` the completion of the
commitment, which is `issued` of `COMMITMENT.json` (`issuedIs`), all in Unix seconds. `issued` is
to the second, `YYYY-MM-DDTHH:MM:SSZ`, as at the top of `COMMITMENT.md`; a value in any other
form, or one that is not a date of the calendar, leaves `I` empty and stops the block. `jq` reads
2026-02-30 as 2026-03-02 without an error, so each date is read back with `todate` and must give
the same string, without the fraction of a second for the records:

```bash
{
: "${RM:?set the names of section 1 first}" "${RM_BUNDLE:?set the names of section 1 first}"
: "${T:?set the names of section 1 first}" "${CLOSED:?set the names of section 1 first}" "${PUBLIC?run section 6 first}"
PAIR='def pair($k): ((.what // "") | capture("(^|[ ,;(=])" + $k + "=(?<v>[^ ,;)]+)").v | sub("\\.$"; "")) // null;'
TM=$(jq -r '.verificationMaterial.tlogEntries[0].integratedTime' "$RM_BUNDLE")
W0=$(jq -n '"2026-10-13T12:36:00Z" | fromdateiso8601')
I=$(jq -r '.issued | select(test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
  | . as $s | (fromdateiso8601)? | select(todate == $s)' COMMITMENT.json)
: "${I:?issued of COMMITMENT.json is not a real date in the form YYYY-MM-DDTHH:MM:SSZ}"
echo "issued in COMMITMENT.md: $(grep -c -F "Completed at $(jq -r '.issued' COMMITMENT.json) (UTC" COMMITMENT.md)"
if [ "$W0" -lt "$I" ] && [ "$I" -lt "$T" ]; then echo "order ok"; else echo "ORDER FAIL"; fi
jq -r '.records | group_by(.kind)[] | "\(.[0].kind) \(length)"' "$RM"
jq -r '[.records[].kind] | unique - ["kit-start", "kit-start-result", "isolation-check",
    "isolation-check-result", "index-check", "index-check-result", "index-build", "attempt-result",
    "attempt", "receipt-withheld", "refused", "receipt-check", "re-creation", "provider-request",
    "server-query", "other"]
  | "kinds outside the table: \(.)"' "$RM"
jq -r '([.records[] | select(.kind == "attempt" or .kind == "attempt-result")
         | (.what // "") | split(" ")[1] // ""] | unique) as $named
  | "attempts without a record: \(.attempts - $named)",
    "records without a name in attempts: \($named - .attempts)"' "$RM"
}
```

Expected: `issued in COMMITMENT.md: 1`, the time at the top of `COMMITMENT.md` is `issued`;
`order ok`, 2026-10-13T12:36:00Z is earlier than `issued` and `issued` earlier than `T`, as
`issuedIs` says; the counts of each kind; `kinds outside the table: []`; both lists of attempts
`[]`. `attempts` names every public attempt that started, at any outcome, and the names in the
`attempt` and `attempt-result` records are the same set. A `refused` record is not an attempt and
is not in `attempts`.

Dates and phases:

```bash
{
: "${W0:?run the first block of this section first}" "${I:?run the first block of this section first}" "${TM:?run the first block of this section first}"
: "${T:?set the names of section 1 first}" "${RM:?set the names of section 1 first}"
jq -r --argjson w "$W0" --argjson i "$I" --argjson t "$T" --argjson m "$TM" '
  ("2026-10-12T21:36:53Z" | fromdateiso8601) as $b
  | .records[]
  | ((.date // "")
     | if test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$")
       then (sub("\\.[0-9]{3}Z$"; "Z") | . as $s | ((fromdateiso8601)? // null)
             | if . != null and todate == $s then . else null end)
       else null end) as $d
  | (if $d == null then false
     elif .kind == "index-build" and $d == $b then .phase == "before-completion"
     elif .phase == "before-completion" then $d >= $w and $d < $i
     elif .phase == "before-signature" then $d >= $i and $d < $t
     elif .phase == "after-signature" then $d >= $t
     else false end) as $ok
  | [(.date // "-"), (.phase // "-"), (.machine // "-"), (.kind // "-"),
     (if $ok and $d <= $m then "ok" else "DATE OR PHASE" end)]
  | @tsv' "$RM" | sort
}
```

Expected: `ok` on every line. The date has one of the two forms above, is a date of the
calendar, and the phase agrees with
it: `before-completion` from `W0` to `I`, `before-signature` from `I` to `T`, the entry of the
commitment, and `after-signature` from `T`; no record is earlier than `W0`, except one: the
`index-build` of the build of the public runs, dated 2026-10-12T21:36:53Z, the time of its check
(`COMMITMENT.md`, section 10), with the phase `before-completion`; none is later than the entry of
the result manifest.

Starts of the kit:

```bash
{
: "${PAIR:?run the first block of this section first}" "${RM:?set the names of section 1 first}"
jq -r "$PAIR"' .records[] | select(.kind == "kit-start" or .kind == "kit-start-result")
  | [(.what // "") | scan("--[a-z-]+")] as $modes
  | (if .phase == "before-signature" then ["--check", "--freeze-check"]
     elif .phase == "after-signature"
     then ["--check", "--freeze-check", "--list-ping", "--rescore", "--manifest", "--baseline", "--model"]
     else null end) as $ok
  | pair("result") as $res | pair("exit") as $exit
  | [.date, .kind, .phase, .what,
     (if .kind == "kit-start-result"
      then (if .phase == "before-completion" then "-"
            elif $res == null then "NO RESULT"
            elif ($res | IN("differs", "failed", "mismatch")) then "FINDING"
            elif ($res | IN("ok", "match")) and ($exit == null or $exit == "0") then "ok"
            else "READ BY HAND" end)
      elif ($modes | length) == 0 then "NO MODE"
      elif $ok == null or ($modes | all(IN($ok[]))) then "ok" else "NOT ALLOWED" end)]
  | @tsv' "$RM"
}
```

Expected: `ok` on every `kit-start`. Between the completion of the commitment and its signature,
only `--check` and `--freeze-check`; after the signature, also `--list-ping`, `--rescore` and the
starts of the attempts; no `--model-ping`, `--assemble` or `--rubric-test` after the completion of
the commitment. A start of an attempt names its mode and the attempt, as in
`kit-start --baseline (public attempt 1, dir public-baseline-1)`. A start refused before any
network call is no attempt, so the next start of that mode carries the same number.

A result record is judged from the completion of the commitment on: in the phases
`before-signature` and `after-signature` it says `result=ok` for `--check` and `--freeze-check`
and `result=match` for `--rescore`, with `exit=0` where it gives the code, and shows `ok`;
`differs`, `failed` or `mismatch` shows `FINDING`, a finding of that start; `NO RESULT` and
`READ BY HAND` are read by hand. A result in the phase `before-completion` shows `-` and is no
finding: before the completion the text still had values to fill, so `--check` gives `differs` and
`--freeze-check` gives `failed` there by design. The result of the start of an attempt is in its
`attempt-result` or `attempt` record.

Isolation and the index:

```bash
{
: "${PAIR:?run the first block of this section first}" "${RM:?set the names of section 1 first}"
jq -r "$PAIR"' .records[] | select(.kind == "isolation-check-result")
  | [.date, .phase, .machine, pair("result"), pair("exit")] | @tsv' "$RM"
jq -r "$PAIR"' .records[] | select(.kind == "index-check-result")
  | [.date, .phase, pair("result"), pair("index"), pair("created"), pair("version"),
     pair("index_version"), pair("index_current"), pair("documents")] | @tsv' "$RM"
jq -r '.records[] | select(.kind == "index-build" or .kind == "re-creation" or .kind == "server-query"
  or .kind == "provider-request" or .kind == "refused" or .kind == "receipt-check" or .kind == "other")
  | [(.date // "-"), .kind, (.phase // "-"), (.what // "")] | @tsv' "$RM"
}
```

Expected:

- `result=confirmed` for every run of the isolation check;
- for every check of the index `result=ok`, `version` and `index_version` `20260909221001-juh`,
  `index_current` `true`, 72236 documents, and as `created=` the build in force: that of the
  public runs, 2026-10-12T20:36:41.284Z (`COMMITMENT.md`, section 10), or a later build that has
  its own `index-build` record;
- the first `index-build` is the build of the public runs; each later one is a new build, named
  with its time and followed by a check of the index;
- every `re-creation` re-creates the two runner containers of the stand and leaves the matching
  server and its index untouched;
- every `provider-request` names the request and whether it carried a key (`key=yes` or `no`);
  read each one, with its `machine`;
- `server-query` records are written by hand; read each one;
- every `refused` record says that nothing was written and that it is no attempt;
- `other` records are read by hand. The closed checks are split at 2026-10-13T12:36:00Z: those
  before it are disclosed in section 10 of the commitment, those from then until its signature in
  the result manifest (`COMMITMENT.md`, section 8); a closed check of no kind above is recorded as
  `other`, so an `other` record is not a finding by itself; read what it says.

Attempts against the receipts:

```bash
{
: "${PAIR:?run the first block of this section first}" "${CLOSED:?set the names of section 1 first}"
: "${RM:?set the names of section 1 first}"
jq -r "$PAIR"'
  [.receipts[].sha256] as $listed
  | [.records[] | select(.kind == "receipt-withheld") | "\(pair("runId")) \(pair("sha256"))"] as $withheld
  | .records[] | select(.kind == "attempt-result")
  | pair("sha256") as $s | "\(pair("runId")) \($s)" as $w
  | [.date, pair("runId"), pair("status"), pair("exit"), pair("receipt"), pair("checksFailed"), pair("withheld"),
     (if $s == null then "NO DIGEST"
      elif pair("withheld") == "yes"
      then (if ($withheld | index([$w])) and ($listed | index([$s])) == null then "withheld" else "WITHHELD MISMATCH" end)
      elif pair("withheld") == "no" then (if ($listed | index([$s])) then "listed" else "MISSING" end)
      else "NO WITHHELD" end)] | @tsv' "$RM"
jq -r "$PAIR"' .records[] | select(.kind == "attempt")
  | [(.date // "-"), ((.what // "") | split(" ")[1] // "-"), (pair("runId") // "NO RUNID"),
     (pair("logSha256") // "NO LOG DIGEST"),
     (if ((.what // "") | test("interrupted")) then "interrupted"
      elif ((.what // "") | test("without receipt")) then "without receipt" else "OTHER" end)] | @tsv' "$RM"
A=$(jq -c "$PAIR"' [.records[] | select(.kind == "attempt-result") | pair("sha256") | select(. != null)]' "$RM")
jq -r '.receipts[] | "\(.sha256) \(.file)"' "$RM" | while read -r sha f; do
  jq -r --arg s "$sha" --argjson a "$A" --argjson cl "$CLOSED" 'select(($cl | index([$s])) | not)
    | "\(.runId) \(if ($a | index([$s])) then "recorded" else "NO ATTEMPT RECORD" end)"' "$f"
done
}
```

Expected:

- every `attempt-result` with `withheld=no` is `listed`: its `sha256` is in `receipts`;
- every `attempt-result` with `withheld=yes` is `withheld`: a `receipt-withheld` record has the
  same `runId` and `sha256`, and the receipt is not in `receipts`;
- no `MISSING`, `WITHHELD MISMATCH`, `NO DIGEST` or `NO WITHHELD`;
- every `attempt` record is `interrupted` or `without receipt`, with a `runId` or `none` and a
  log digest or `none`; no `NO RUNID`, `NO LOG DIGEST` or `OTHER`. An `interrupted` attempt whose
  receipt was found afterwards also has its `attempt-result`;
- every public receipt is `recorded`.

Attempts, from the receipts and the records, in the order of their start:

```bash
{
: "${PUBLIC?run section 6 first}" "${PAIR:?run the first block of this section first}" "${RM:?set the names of section 1 first}"
ATT=$({ for f in $PUBLIC; do
    jq -r '[((.runId // "") | split("-")[0]),
         (((.runId // "") | capture("(?<t>[0-9]{8}T[0-9]{6}Z)") | .t | strptime("%Y%m%dT%H%M%SZ") | todate)? // "-"),
         ((.when // "-") | sub("\\.[0-9]+Z$"; "Z")), (.status // "-"), (.rerun // "-"),
         (.rubric.outcome // "-"), (.runId // "-")]
      | @tsv' "$f"
  done
  jq -r "$PAIR"'
    def norm: (. // "-") | sub("\\.[0-9]+Z$"; "Z");
    def mode: (((.what // "") | split(" ")[1] // "" | capture("^public-(?<m>[a-z]+)-") | .m)?)
              // (((pair("runId") // "") | capture("^(?<m>baseline|model)-") | .m)?) // "-";
    def name: (.what // "") | split(" ")[1] // "";
    [.receipts[].file | capture("^runs/(?<id>.+)\\.json$") | .id] as $ids
    | [.records[] | select(.kind == "receipt-withheld") | pair("runId") // empty] as $held
    | [.records[] | select(.kind == "kit-start")] as $starts
    | .records[]
    | select((.kind == "attempt" and ((.what // "") | test("interrupted|without receipt"))
              and ((pair("runId") // "") | IN($ids[], $held[]) | not))
             or .kind == "receipt-withheld")
    | . as $r
    | ((((pair("runId") // "") | capture("(?<t>[0-9]{8}T[0-9]{6}Z)") | .t
         | strptime("%Y%m%dT%H%M%SZ") | todate)?)
       // ([$starts[] | select(((.what // "") | contains("dir " + ($r | name) + ")"))
                              and ((.date | norm) <= ($r.date | norm)))]
           | sort_by(.date | norm) | last | .date // empty | norm)
       // ($r.date | norm)) as $start
    | [($r | mode), $start, "-", (if .kind == "receipt-withheld" then "withheld" else "no-receipt" end),
       "-", "-", (pair("runId") // "-")] | @tsv' "$RM"
} | sort)
printf '%s\n' "$ATT" | awk -F'\t' 'NF == 0 { next }
  { print }
  $1 == m { n++
            if (!(ps == "not-completed" && pr == "eligible")) { print "FAIL " $7 ": the attempt before it allows no rerun"; bad = 1 }
            if ($2 < pw) { print "FAIL " $7 ": started before the receipt of the attempt before it"; bad = 1 } }
  $1 != m { n = 1 }
  n == 4  { print "FAIL " $1 ": more than three attempts"; bad = 1 }
  { m = $1; ps = $4; pr = $5; pw = $3 }
  END { print (bad ? "attempts FAILED" : "attempts ok") }'
}
```

Columns: mode, start, `when`, status, `rerun`, outcome, `runId`. For a record, the mode is taken
from the name of the attempt (`public-<mode>-<N>`, the second word of `what`). The start is taken
from its `runId`; when the `runId` is `none`, from the `date` of the last `kit-start` record of
that attempt (`... dir <name>)`) before it, since the record itself is written later, sometimes
at the next start; the last one, because after a refused start the same name is used again; and
only without such a `kit-start`, from the `date` of the record. An `interrupted` record whose
`runId` has a receipt in `receipts` or a `receipt-withheld` record is left out: that attempt is in
the table once, by its receipt or by its withheld record. Expected: no `FAIL` line, and the last
line `attempts ok`. Times are compared to the second, as `runId` gives them. The block keeps the
table as `ATT` for the next one.

The token of the commitment before the first public attempt. The public runs start only after the
timestamp token of `COMMITMENT.json` is obtained (`COMMITMENT.md`, section 14), so its time is
compared with the earliest start in the table:

```bash
{
: "${ATT?run the block of the attempts first}"
TL=$(openssl ts -reply -in COMMITMENT.json.tsr -text | sed -n 's/^Time stamp: //p')
: "${TL:?no time in COMMITMENT.json.tsr}"
TS=$(date -u -d "$TL" +%s)
F=$(printf '%s\n' "$ATT" | awk -F'\t' '$2 ~ /^[0-9]/ { print $2 }' | sort | head -n 1)
echo "token $(date -u -d "@$TS" +%Y-%m-%dT%H:%M:%SZ)"
echo "first start ${F:--}"
if [ -n "$F" ]; then echo "start minus token: $(( $(date -u -d "$F" +%s) - TS )) s"; fi
}
```

Expected: a positive difference: the token is older than the first start of a public attempt.
With no attempt, `first start -` and no difference. The two times come from two clocks: the time
of the token from that of the timestamp service, the start from that of the machine of the runs
(`COMMITMENT.md`, section 13). A negative difference is a finding; report it in seconds, with
this caveat, since it does not by itself show which clock was off.

The model after the baseline, on its build of the index:

```bash
{
: "${B:?run section 8 first}" "${PAIR:?run the first block of this section first}"
: "${PUBLIC?run section 6 first}" "${RM:?set the names of section 1 first}"
P=$(jq -r '.runId | capture("(?<t>[0-9]{8}T[0-9]{6}Z)").t | strptime("%Y%m%dT%H%M%SZ") | todate' "$B")
jq -r '.when' "$B"
E=$(for f in $PUBLIC; do
  jq -r 'select(.runId | startswith("model-")) | .when | sub("\\.[0-9]+Z$"; "Z")' "$f"
done | sort | tail -n 1)
jq -r --arg p "$P" --arg e "$E" "$PAIR"' .records[]
  | ((.date // "") | sub("\\.[0-9]+Z$"; "Z")) as $d | select($d > $p and $d < $e)
  | select(.kind == "index-build" or .kind == "index-check-result")
  | [.date, .kind, (pair("created") // "-")] | @tsv' "$RM"
}
```

Expected: every model attempt in the table starts after the `when` of the baseline attempt that
passed section 8. Between the start of that attempt and the end of the last model attempt there
is no `index-build`, and every check of the index names the same `created=`: the model ran on the
build of that baseline attempt. With no model attempt, `E` is empty and the last command prints
nothing.

The result over the attempts of the model, from every completed pass:

```bash
{
: "${PUBLIC?run section 6 first}"
for f in $PUBLIC; do
  jq -r 'select(.runId | startswith("model-"))
    | .runId as $id | .passes[] | select(.status == "completed") | .rubric as $r
    | "\($id) pass-\(.index) \($r.outcome) \($r.gate) missed=\($r.numbers.missedSanction) of \($r.numbers.hitN) hold=\($r.numbers.holdDecisions) hitPrecision=\($r.numbers.hitPrecision)"' "$f"
done
}
```

Expected: by the rule above, the result the publication states. If an attempt has the verdict
`failed` (outcome column of the table), the result is `failed`; otherwise, if the last attempt
completed, it is the worst of these passes (`failed`, then `works-with-controls`, then `works`).

The completeness of the records cannot be checked from the published files (section 12).

## 11. Your own run and calibration

A new run, at your cost, compared by the rule the commitment declared before the run
(`COMMITMENT.md`, section 15). It needs:

- the same export, byte for byte: its SHA-256 is `exportSha256` of `snapshot.json`. The export is
  not published by us, and the commitment does not say how a reviewer would obtain it. The kit
  refuses another file with exit 2 before any network call;
- a matching server as `server` in `snapshot.json` gives it: `yente` 5.5.0 from the pinned image
  for `linux/amd64`, the environment of `server.params.env`, the manifest `offline.yml`, the index
  on Elasticsearch 9.4.8 from the pinned image, built by you from this export;
- for the model, your own API key with the provider and its API address. No key of ours is given.

The run talks to your server and, for `--model`, to the provider. Your run logs
(`runs/*.log.jsonl`) hold the assembled rows, the answers of the model and of the server: do not
publish them. A receipt holds no value of an assembled row other than its `id`, `type` and
`country`, which are public, no caption of a candidate from the list responses, no string
argument of a tool call and no reason text from the log (`COMMITMENT.md`, section 8); it does
hold texts of the kit, such as `why`, `meta.title`, the banner and `candidate.methods`.

Set your own values, outside the kit:

```bash
EXPORT=     # the absolute path of the entities file of your copy of the export
LIST_URL=   # your matching server, for example http://127.0.0.1:8000
ES_URL=     # its Elasticsearch, for example http://127.0.0.1:9200
```

**Server.** With `versionCheck` `"description"`, the list version comes from `snapshot.json`; the
server sends none, and `--list-ping` prints the version it serves without comparing it. Check the
server yourself, as the party that executes the runs did for every build:

```bash
curl -fsS "$LIST_URL/catalog" | jq -c '(.datasets[] | select(.name == "us_ofac_sdn")
  | {name, version, index_version, index_current}), {index_stale}'
curl -fsS "$ES_URL/_cat/indices/yente-entities-*?v&h=index,docs.count,docs.deleted"
curl -fsS "$ES_URL/yente-entities-*/_count" | jq '.count'
```

Expected: `version` and `index_version` `20260909221001-juh`, `index_current` `true`,
`index_stale` `false`; one index `yente-entities-us_ofac_sdn-...-20260909221001-juh`, and
`_count` 72236.

**Copy.** A clean copy as in section 7, with `COMMITMENT.md` and `COMMITMENT.json` added: `--model`
runs only under a commitment that passes the freeze check. No `.env`: every setting is given on
the command line.

```bash
W=$(mktemp -d)
while read -r sum f; do cp -- "$f" "$W/"; done < SHA256SUMS
cp SHA256SUMS COMMITMENT.md COMMITMENT.json "$W/"
```

**Step 1. Assembly.**

```bash
( cd "$W" && env -i PATH="$PATH" LIST_EXPORT_PATH="$EXPORT" node run.mjs --assemble < /dev/null
  echo "exit=$?" ) | grep -v '^ROW'
( cd "$W" && env -i PATH="$PATH" LIST_EXPORT_PATH="$EXPORT" node run.mjs --assemble < /dev/null ) \
  | grep '^ROW' | diff - <(jq -r '.input.parties[] | "ROW \(.id) \(.source) \(.inputSha256)"' "$B")
echo "diff=$?"
```

Expected: `ASSEMBLY completed rows=69 entity=37 literal=32 sha256=1563f87fd858f0ac34f556808f34822b4963d8e9f7ca73822f97a20e6d71bd75`,
the `input.assemblySha256` of the published receipts and of the expected result, and `exit=0`;
then `diff=0`. `ASSEMBLY not-completed row=<id> code=<code>` with exit 4, or another digest: not
the same export or not the same book.

**Step 2. Baseline.**

```bash
( cd "$W" && env -i PATH="$PATH" LIST_EXPORT_PATH="$EXPORT" LIST_BASE_URL="$LIST_URL" \
    node run.mjs --baseline < /dev/null; echo "exit=$?" )
```

Expected: `DECISIONS pass-1 rows=69 sha256=925ec682edccc0dd8aeaaf80d6e2329dc2db8ed34b05dd97c4a297aefa8fcaf4`,
equal to `passes[0].decisionsSha256` of the published baseline; `OUTCOME failed`,
`GATE missed-sanction`; `exit=5`. Your receipt is `$W/runs/baseline-latest.json` and its own
`runs/<runId>.json`.

If the digest differs, the calibration failed. Do not compare your `--model` with the published
one. Name the rows where it differs, by `id` and key path:

```bash
jq -n -r --slurpfile a "$B" --slurpfile b "$W/runs/baseline-latest.json" '
  [$a[0].passes[0].decisions, $b[0].passes[0].decisions] | transpose[]
  | select(.[0] != .[1])
  | (.[0].id // .[1].id) as $id | .[0] as $x | .[1] as $y
  | ([$x, $y] | map([paths(scalars)]) | add | unique)[] as $p
  | select(($x | getpath($p)) != ($y | getpath($p)))
  | "\($id) \($p | map(tostring) | join("."))"'
```

The divergence of the calibration is a finding (`COMMITMENT.md`, sections 13 and 15). A stop of
the list (exit 4 with a list class or `version`) is a problem of your setup, not a result.

**Step 3. Model.** Only after the calibration passed. The settings are those of the commitment;
the kit compares them with `COMMITMENT.json` and refuses with exit 2, naming the variables that
differ, before any network call. Do not set `CANDIDATE_PROVIDER`, `CANDIDATE_TEMPERATURE`,
`LIST_TIMEOUT_MS`, `MODEL_TIMEOUT_MS` or `RETRY_MAX`: the commitment fixes their defaults.

```bash
( cd "$W" && env -i PATH="$PATH" LIST_EXPORT_PATH="$EXPORT" LIST_BASE_URL="$LIST_URL" \
    CANDIDATE_MODEL=claude-sonnet-5 CANDIDATE_API_STYLE=anthropic CANDIDATE_THINKING=disabled \
    CANDIDATE_MAX_TOKENS=1024 CANDIDATE_BASE_URL="$CANDIDATE_BASE_URL" CANDIDATE_API_KEY="$CANDIDATE_API_KEY" \
    node run.mjs --model < /dev/null; echo "exit=$?" )
```

`CANDIDATE_BASE_URL` and `CANDIDATE_API_KEY` are yours, set in your shell. `env` receives the key
as an argument, so run this on a machine only you use. Keep the key out of the kit folder and out
of any report. Three passes over 69 rows, each row up to 8 model turns: the cost is yours.

Expected: `PASS 1`, `PASS 2` and `PASS 3` with `STATUS completed`, each with its `DECISIONS` line,
then `OUTCOME`, `GATE` and `NUMBERS`, and `exit=0`, or `exit=5` with the outcome `failed`. A run
not completed ends with `RERUN eligible` or `RERUN not-eligible` and `exit=4`, or `exit=5` when
it already has the verdict `failed`; a rerun follows the rule of section 10. Your receipt is
`$W/runs/latest.json`; section 9 applied to it gives `true`. Another returned model id shows in `deviations`: then your run is not a run of
the committed model, and you say so.

**Compare.** Your attempts follow the rule of section 10: a rerun only after an attempt not
completed with `rerun: "eligible"`, at most two per mode. The result over your attempts, under the
same thresholds, equals the published result over the attempts. Beside it, for both runs, give per
pass the missed sanctions (k of 25), the hold answers and the hit precision, as the last command
of section 10 prints them. No byte-for-byte agreement of the model is required. Another result is a
divergence; the same result under another gate is a finding. Both are published, and the
divergence is stated before any explanation.

A run on another export is a separate result, not a re-execution of this one. The frozen kit
refuses another export file by its SHA-256, with exit 2, before any assembly; such a run needs
another `snapshot.json`, under a new commitment.

## 12. What these checks cannot establish

Without the export and the run logs, which are not published:

- the assembly of the 37 rows derived from entities: re-scoring prints `UNVERIFIED input.assemblySha256`;
  only your own assembly on the same export checks it (section 11);
- that the decision rows of the model came from the model: the answers are in the logs. Each model
  row carries `responseSha256`, and each receipt the SHA-256 of its log, so a log line disclosed
  later can be checked against its row;
- the leak check: it runs over the logs;
- the stops of the runner, `RUN UNVERIFIED` and `PASS <i> UNVERIFIED`, and the error class of an
  invalid row (`error.class`), on which `rerun` also rests (section 7). The party that executes the
  runs operates the local server and holds the network; the rules limit cut-off passes and reruns,
  but a receipt does not tell a real failure from a caused one. The kit gives the class `network` to
  every request that throws before its response has been read, other than by its timeout, also to
  one that never left the machine; the cause is in the log, not in the receipt;
- the network and the isolation of the stand: the proxy, the networks without a way out and the
  isolation checks rest on the statements of the party that executes the runs and on the records;
- from which export the index of the server was built: the kit takes the list version from
  `snapshot.json`; the builds rest on the checks of `/catalog` and the number of documents;
- the completeness of the records: the result manifest lists what was recorded; an attempt, a
  start or a check left out would not show. Requests to the API of the model provider made from
  another machine and without the key used by the public runs are not recorded at all
  (`COMMITMENT.md`, section 14). Numbering makes a skipped commitment visible; it does not prevent
  one;
- the time of the runs: the `when` and the time in `runId` come from the clock of the party that
  executes the runs. The log entry and the token show that the commitment existed no later than
  their time; no value known only after the signature enters a run, so nothing bounds the time of a
  run from below;
- that nobody knew the expected baseline figures: they come from the closed rehearsals
  (`COMMITMENT.md`, section 10). The model has no expected figures;
- who signed: the four signatures show one email address, confirmed by a sign-in to GitHub through
  Sigstore at each signing. That is not one person, and `cosign` does not check that the GitHub
  account was the same;
- the closed checks: those before 2026-10-13T12:36:00Z are disclosed in section 10 of the
  commitment, those from then until its signature in the result manifest (`COMMITMENT.md`,
  section 8); they are disclosed, not proven, and what they influenced cannot be shown.

None of it shows that the method and thresholds suit the adjudication of screening matches, that
the book and its reference answers are right, or anything about another list, export, book, model
or setting. The bound describes this SAMPLE book, not the task class. The review was internal;
this is not an audit.

## 13. Reporting a finding

A finding of an external check is published as a separate dated record and goes into the next
commitment (`COMMITMENT.md`, sections 11 and 15). A report gives:

- each section of this file with PASS, SKIP or FAIL, and the reason for every SKIP;
- the digests used: `S`, `C`, the result manifest and each receipt; the log indices and token times
  as read; the identity and issuer required; the versions of `cosign`, `openssl` and Node.js;
- what did not match: the exact lines (`FAILED`, `RESCORE mismatch ...`, `diff` output, `false`),
  the published value and yours;
- for your own run: the SHA-256 of your receipts and the figures the rule compares; for a failed
  calibration, the rows by `id` and key path. Not your logs, not values of rows, not your key;
- your ties to Role Exposure, the party that executes the runs, the model provider, the list vendor
  or vendors of screening solutions.

A divergence is published, and it is stated before any explanation (`COMMITMENT.md`,
section 15).
