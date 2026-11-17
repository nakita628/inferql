/**
 * inferql, all in one:
 *
 * - `connect` (`inferql/sqlite`, `inferql/mysql`, `inferql/postgres`) — `sql()` bound to a
 *   database: `sql('SELECT id FROM users WHERE id = ?', 1)` runs the query and returns its
 *   rows, typed from the query text and the project's `.sql` migrations, which TypeScript 7.1
 *   reads through inferql's content mapper. `sql.as<Row>('...')` names the type for what the
 *   parser cannot read; the linter keeps it in sync with the database.
 * - `inferql/oxlint` — the oxlint plugin that prepares every query against the database.
 * - `bindSql` / `bindAsyncSql` — the same `sql()` over any other driver; `Dialect` is the
 *   contract the lint rule uses for any other database.
 */
export type {
  ColumnNullability,
  Config,
  Connection,
  ConnectionConfig,
  DescribedColumn,
  DescribedParameter,
  DescribeResult,
  Dialect,
  IntrospectedColumn,
  IntrospectedTable,
  IntrospectResult,
  Target,
} from './core/index.js'
export { bindAsyncSql, bindSql } from './typed/index.js'
export type {
  ActiveSchema,
  AsyncSql,
  InferParams,
  InferRow,
  Migrations,
  MigrationsSchema,
  Parse,
  SyncSql,
  UnknownRow,
} from './typed/index.js'
export type { CheckRequest, CheckResponse } from './protocol.js'
