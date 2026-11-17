<!--
Title: `type(scope): summary` — imperative mood, no trailing period. Write it for the
person reading the release notes, not for the diff.

  type   feat | fix | perf | refactor | docs | test | build | ci | chore
  scope  typed | rules | dialects | sqlite | mysql | postgres | cli | core | example | lint | docs | ci

  fix(typed): make every column of the right side of a LEFT JOIN nullable
-->

## Why

<!-- The bug, the missing capability or the request behind this change. Link the issue: `Closes #123`. -->

## What

<!-- What changed, as a user of `sql()` or the lint rule sees it. One to three sentences. -->

## Where

<!-- Scope: the type-level parser, the oxlint rule, a dialect, the CLI, an example. Name what is deliberately left out. -->

## Who

<!-- Who notices: every user, users of one dialect, contributors only. Breaking for anyone? -->

## When

<!-- Release impact: `none` | `next release` | `version bumped to x.y.z`. -->

## How

<!--
The approach in a sentence, then the evidence. If inference changed, paste the query and
the type it now infers. Tick only what you ran; paste the output of anything that failed.
-->

- [ ] `vp run check`
- [ ] `vp run test`
- [ ] `vp run example`
- [ ] `vp run example:mysql` / `vp run example:postgres`, when a server dialect changed
