# Pre-run commitments of Role Exposure

This is the public list of the pre-run commitments of all packs of Role Exposure, the pack owner. They share one sequence of numbers.

- A number is assigned to a commitment before the runs it describes and is never reused. No. 1 is the exception: its number was assigned retroactively, in this list.
- A superseded commitment keeps its number and stays published, with the reason it was superseded. A change is a new commitment with a new number, which names the one it supersedes.
- Closed checks before a commitment get no number.
- A gap in the sequence is visible, so selective publication can be detected. The numbering does not prevent it.

Entries are added as the commitments are published.

| No. | Pack | Surface | Commitment | Note |
|---|---|---|---|---|
| 1 | `rec.bank-ledger.v1` | P01-PUBLIC | `COMMITMENT.md` as published in `https://github.com/Role-Exposure/harbor-ledger-demo`, at commit 9c7a492ac2eb2ca48181d8690f08ebecff307716, SHA-256 eaeb68744dc0090370730500ecab18e9c5f64d65c4ebd14957f5092ea189e762 | Numbered retroactively, in this list. The signature of the manifest of that pack does not cover this commitment. |
| 2 | `kyc.sanctions-adjudication.v1` | P02-PUBLIC | `COMMITMENT.json` in this repository, SHA-256 deab31989bb23435c0a08d3ffd8a41d8d2718d7f211335bd4efe8804a0f7443a, which pins `COMMITMENT.md`, SHA-256 bc25615c9646da57144ad4eb568b487154f10fa4f5fba94758db54696aba8578 (`prose.sha256`); its signature bundle `COMMITMENT.json.sigstore.json` and its timestamp token `COMMITMENT.json.tsr` are next to it | Signed and timestamped before the public runs. |
