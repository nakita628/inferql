---
name: Feature request
about: SQL the type-level parser should understand, or a dialect or option to add
title: 'feat: '
labels: ['enhancement']
---

## Why

<!-- The problem, in one paragraph. What do you do today instead (`sql.as`, a manual type)? -->

## What

<!-- The behaviour you want: the query in, the row and parameter types out. -->

```ts
sql('SELECT ... FROM ...')
// should infer: { ... }
```

## Where

<!-- Which dialects it applies to, and whether it is the parser, the lint rule or the CLI. -->
