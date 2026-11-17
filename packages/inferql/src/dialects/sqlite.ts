import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { StatementSync } from 'node:sqlite'

import { describeFailure } from '../core/index.js'
import type {
  ColumnNullability,
  Connection,
  DescribeResult,
  DescribedColumn,
  Dialect,
  IntrospectResult,
} from '../core/index.js'

/**
 * SQLite's type affinity rules (https://www.sqlite.org/datatype3.html#affname), read from a
 * declared column type, plus the conventional date/time and JSON spellings that store text.
 */
export function toTsType(dataType: string): string {
  const upper = dataType.toUpperCase()
  if (upper.includes('INT')) return 'number'
  if (upper.includes('CHAR') || upper.includes('CLOB') || upper.includes('TEXT')) return 'string'
  if (upper.includes('BLOB') || upper === '') return 'Uint8Array'
  if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'number'
  if (upper.includes('DATE') || upper.includes('TIME') || upper.includes('JSON')) return 'string'
  return 'number'
}

/**
 * Resolves the connection string to what `DatabaseSync` opens: `:memory:` as-is, a `file:` URL
 * or a bare path relative to the project.
 */
export function resolveDatabasePath(databaseUrl: string, projectDir: string): string {
  if (databaseUrl === '' || databaseUrl === ':memory:') return ':memory:'
  const stripped = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl
  return path.isAbsolute(stripped) ? stripped : path.resolve(projectDir, stripped)
}

type TableInfoRow = {
  readonly name: string
  readonly notnull: number
  readonly pk: number
}

function isTableInfoRow(row: unknown): row is TableInfoRow {
  return (
    typeof row === 'object' &&
    row !== null &&
    typeof Reflect.get(row, 'name') === 'string' &&
    typeof Reflect.get(row, 'notnull') === 'number' &&
    typeof Reflect.get(row, 'pk') === 'number'
  )
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function tableInfo(
  db: DatabaseSync,
  cache: Map<string, TableInfoRow[]>,
  table: string,
): TableInfoRow[] {
  const cached = cache.get(table)
  if (cached !== undefined) return cached
  const rows = db
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all()
    .filter(isTableInfoRow)
  cache.set(table, rows)
  return rows
}

function nullabilityOf(rows: readonly TableInfoRow[], column: string): ColumnNullability {
  const row = rows.find((candidate) => candidate.name === column)
  if (row === undefined) return 'unknown'
  return row.notnull === 1 || row.pk > 0 ? 'not-null' : 'nullable'
}

function describeStatement(
  db: DatabaseSync,
  statement: StatementSync,
  cache: Map<string, TableInfoRow[]>,
): DescribeResult {
  const columns: DescribedColumn[] = statement.columns().map((column) => {
    const table = column.table ?? undefined
    const source = column.column ?? undefined
    const nullability =
      table !== undefined && source !== undefined
        ? nullabilityOf(tableInfo(db, cache, table), source)
        : 'unknown'
    return { name: column.name, dataType: column.type ?? null, nullability, table, column: source }
  })
  return { ok: true, columns }
}

type MasterRow = { readonly name: string }

function isMasterRow(row: unknown): row is MasterRow {
  return typeof row === 'object' && row !== null && typeof Reflect.get(row, 'name') === 'string'
}

function isTypedTableInfoRow(row: unknown): row is TableInfoRow & { readonly type: string } {
  return isTableInfoRow(row) && typeof Reflect.get(row, 'type') === 'string'
}

function introspect(db: DatabaseSync): IntrospectResult {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .filter(isMasterRow)
    .map((table) => ({
      name: table.name,
      columns: db
        .prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`)
        .all()
        .filter(isTypedTableInfoRow)
        .map((column) => ({
          name: column.name,
          dataType: column.type,
          nullability: nullabilityOf([column], column.name),
        })),
    }))
  return { tables }
}

function open(databaseUrl: string, projectDir: string): Connection {
  const db = new DatabaseSync(resolveDatabasePath(databaseUrl, projectDir))
  const cache = new Map<string, TableInfoRow[]>()
  return {
    describe(queryText) {
      try {
        return Promise.resolve(describeStatement(db, db.prepare(queryText), cache))
      } catch (error) {
        return Promise.resolve(describeFailure(error))
      }
    },
    exec(sqlText) {
      db.exec(sqlText)
      cache.clear()
      return Promise.resolve()
    },
    introspect() {
      return Promise.resolve(introspect(db))
    },
    close() {
      db.close()
      return Promise.resolve()
    },
  }
}

/**
 * The SQLite dialect. Statements are prepared with `node:sqlite`, which reports each result
 * column's declared type and source; nullability comes from `PRAGMA table_info`. Runs fully
 * in-process, so an in-memory database rebuilt from `migrationsDir` needs no server at all.
 */
export const dialect: Dialect = {
  name: 'sqlite',
  toTsType,
  connect(databaseUrl, context) {
    return Promise.resolve(open(databaseUrl, context.projectDir))
  },
}

// The runtime half, for code that runs queries: `sql()` bound to a database (client/sqlite.ts).
// It shares the entry so `import { connect } from 'inferql/sqlite'` is all an app imports.
export { connect } from '../client/sqlite.js'
export type { SqliteSql } from '../client/sqlite.js'
