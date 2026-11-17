---
name: Bug report
about: A query is typed wrong, or the lint rule reports something it should not
title: 'fix: '
labels: ['bug']
---

## What

<!-- What happens (the inferred type, the lint message), and what should happen instead. -->

## Where

<!-- `inferql` version, dialect (sqlite / mysql / postgres) and database version, `oxlint` version, TypeScript version. -->

## How

<!-- The smallest schema and query that reproduce it. -->

```sql
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
```

```ts
sql('SELECT id, name FROM users WHERE id = ?', 1)
// inferred:  ...
// expected:  ...
```

```text
paste the lint output or the type error here
```
