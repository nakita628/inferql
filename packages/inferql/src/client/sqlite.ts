import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'

import { bindSql } from '../typed/index.js'
import type { ActiveSchema, SyncSql } from '../typed/index.js'

/** What `connect` returns: `sql()` that runs the query, and the database for everything else. */
export type SqliteSql = SyncSql<ActiveSchema> & { readonly database: DatabaseSync }

function isInput(value: unknown): value is SQLInputValue {
  return (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  )
}

/** A parameter as `node:sqlite` binds it; a boolean as 1 / 0, as SQLite stores one. */
function toInput(value: unknown): SQLInputValue {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === undefined) return null
  if (isInput(value)) return value
  throw new TypeError(`node:sqlite cannot bind a ${typeof value} parameter`)
}

/** A copy of a row with the ordinary object prototype, which node:sqlite's rows lack. */
function plainObject(row: object): object {
  return { ...row }
}

/**
 * Opens a SQLite database (`node:sqlite`) and returns `sql()` bound to it: the call runs the
 * query and returns its rows, typed from the query text and the schema like any `sql()`.
 *
 * ```ts
 * const sql = connect('app.db')
 * const users = sql('SELECT id, name FROM users WHERE id = ?', 1) // { id: number; name: string }[]
 * ```
 *
 * A statement without rows (an INSERT without RETURNING, DDL) returns `[]`; `sql.database` is
 * the `DatabaseSync` for anything else (`exec`, transactions).
 */
export function connect(path = ':memory:'): SqliteSql {
  const database = new DatabaseSync(path)
  // node:sqlite hands back objects without a prototype; a row is a plain object, so it prints,
  // compares and spreads like any other.
  const sql = bindSql<ActiveSchema>((text, params) =>
    database
      .prepare(text)
      .all(...params.map((value) => toInput(value)))
      .map((row) => plainObject(row)),
  )
  return Object.assign(sql, { database })
}
