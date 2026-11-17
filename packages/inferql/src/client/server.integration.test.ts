import { afterAll, describe, expect, it } from 'vite-plus/test'

import { connect as connectMysql } from '../dialects/mysql.js'
import { connect as connectPostgres } from '../dialects/postgres.js'

// Runs only against real servers: INFERQL_TEST_POSTGRES_URL / INFERQL_TEST_MYSQL_URL. Each test
// recreates its own table, so any scratch database will do.
const postgresUrl = process.env.INFERQL_TEST_POSTGRES_URL
const mysqlUrl = process.env.INFERQL_TEST_MYSQL_URL

describe.skipIf(postgresUrl === undefined)('connect (PostgreSQL)', () => {
  const sql = connectPostgres(postgresUrl ?? '')
  afterAll(() => sql.client.end())

  it('runs sql() and resolves to the rows', async () => {
    await sql.client.unsafe(
      'DROP TABLE IF EXISTS inferql_client; CREATE TABLE inferql_client (id serial PRIMARY KEY, name text NOT NULL, tags text[])',
    )
    expect(await sql.as('INSERT INTO inferql_client (name) VALUES ($1)', 'ada')).toEqual([])
    expect(
      await sql.as('INSERT INTO inferql_client (name, tags) VALUES ($1, $2) RETURNING id', 'bob', [
        'x',
        'y',
      ]),
    ).toEqual([{ id: 2 }])
    expect(await sql.as('SELECT id, name, tags FROM inferql_client WHERE id = $1', 2n)).toEqual([
      { id: 2, name: 'bob', tags: ['x', 'y'] },
    ])
  })

  it('refuses a parameter it cannot bind', async () => {
    await expect(sql.as('SELECT $1', Symbol('x'))).rejects.toThrow(
      'postgres cannot bind a symbol parameter',
    )
  })
})

describe.skipIf(mysqlUrl === undefined)('connect (MySQL)', () => {
  const sql = connectMysql(mysqlUrl ?? '')
  afterAll(() => sql.pool.end())

  it('runs sql() and resolves to the rows', async () => {
    await sql.as('DROP TABLE IF EXISTS inferql_client')
    await sql.as(
      'CREATE TABLE inferql_client (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) NOT NULL, ok BOOLEAN)',
    )
    expect(
      await sql.as('INSERT INTO inferql_client (name, ok) VALUES (?, ?)', 'ada', true),
    ).toEqual([])
    expect(await sql.as('SELECT id, name, ok FROM inferql_client WHERE name = ?', 'ada')).toEqual([
      { id: 1, name: 'ada', ok: 1 },
    ])
  })

  it('refuses a parameter it cannot bind', async () => {
    await expect(sql.as('SELECT ?', Symbol('x'))).rejects.toThrow(
      'mysql2 cannot bind a symbol parameter',
    )
  })
})
