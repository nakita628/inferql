import mysql from 'mysql2/promise'

import { bindAsyncSql } from '../typed/index.js'
import type { ActiveSchema, AsyncSql } from '../typed/index.js'

/** What `connect` returns: `sql()` that runs the query, and the pool for everything else. */
export type MysqlSql = AsyncSql<ActiveSchema> & { readonly pool: mysql.Pool }

type Value = string | number | bigint | boolean | Date | Buffer | null

function toValue(value: unknown): Value {
  if (value === undefined || value === null) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    return value
  }
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new TypeError(`mysql2 cannot bind a ${typeof value} parameter`)
}

/**
 * Opens a MySQL / MariaDB pool (`mysql2`) and returns `sql()` bound to it: the call runs the
 * query and resolves to its rows, typed from the query text and the schema like any `sql()`.
 *
 * ```ts
 * const sql = connect('mysql://root@localhost:3306/app')
 * const users = await sql('SELECT id, name FROM users WHERE id = ?', 1)
 * ```
 *
 * A statement without rows resolves to `[]`; `sql.pool` is the pool for the rest (`end()`).
 */
export function connect(url: string): MysqlSql {
  const pool = mysql.createPool(url)
  const sql = bindAsyncSql<ActiveSchema>(async (text, params) => {
    const [rows] = await pool.query(
      text,
      params.map((value) => toValue(value)),
    )
    return Array.isArray(rows) ? rows : []
  })
  return Object.assign(sql, { pool })
}
