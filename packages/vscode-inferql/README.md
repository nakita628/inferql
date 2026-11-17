# InferQL for VS Code

SQL completion inside `sql(...)`, at the cursor, from the tables your migrations create:

- keywords where they are due — `SELECT`, `FROM`, `WHERE`, `JOIN`, `ORDER BY`, the operators
  after a column, `VALUES` / `SET` / `RETURNING` in a write;
- tables after `FROM`, `JOIN`, `INTO`, `UPDATE`;
- columns of the tables the query names — including the ones after the cursor, so
  `SELECT | FROM users` offers the columns of `users` — and of an alias after `u.`;
- each column with its table, database type and TypeScript type (`users · VARCHAR(255) →
string | null`), each table with its columns.

It completes anywhere in the query, in the middle as well as at the end, and replaces only the
word being typed. Without the extension, inferql's types still offer completions at the end
of a query in any TypeScript editor.

## Setup

Nothing beyond inferql itself. The extension reads the project's connection from
`tsconfig.json`'s inferql content mapper entry (`dialect`, `migrationsDir`) and the schema
through the project's own `inferql/introspect`, so the tables are the ones the lint rule
checks queries against. A project without that entry can name them in the settings:

| Setting                 | Meaning                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `inferql.dialect`       | `sqlite`, `mysql` or `postgres`                              |
| `inferql.migrationsDir` | migrations directory, relative to the nearest `package.json` |
| `inferql.databaseUrl`   | connection string for MySQL and PostgreSQL                   |

A migration or `tsconfig.json` that changes is read again on the next completion. Errors
reading the schema are written to the **InferQL** output channel.

## Run it

Press F5 in this repository (**Run inferql extension**) to open an Extension Development Host
with the extension loaded from `packages/vscode-inferql`; it builds `dist/extension.cjs` first.

To install it, package a VSIX with [vsce](https://github.com/microsoft/vscode-vsce) and use
**Extensions: Install from VSIX...**:

```sh
vp run --filter ./packages/vscode-inferql package   # → packages/vscode-inferql/vscode-inferql.vsix
```

## License

Distributed under the MIT License. See [LICENSE](https://github.com/nakita628/inferql?tab=MIT-1-ov-file) for more information.
