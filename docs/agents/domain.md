# Domain docs

## Layout and reading rules

This repo uses a single-context layout:

- `GLOSSARY.md` at the repo root defines domain terms.
- `docs/adr/` contains numbered architecture decision records.

Before exploring the codebase, read the glossary and any ADRs relevant to the area of work.

If these documents do not exist, proceed silently. The `domain-modeling` skill creates them lazily when terms or decisions are resolved.

## Vocabulary and decisions

Use the glossary's terms in issue titles, proposals, hypotheses, and test names. When a term is missing, reconsider whether it belongs to the project's vocabulary; note real gaps for `domain-modeling`.

If a proposal contradicts an existing ADR, name the ADR and explain why the decision should be reopened.
