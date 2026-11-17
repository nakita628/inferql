import type { SchemaInfo } from 'inferql/introspect'
import { describe, expect, it } from 'vite-plus/test'

import { completeSql } from './complete.js'

const schema: SchemaInfo = {
  dialect: 'sqlite',
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'id', dataType: 'INTEGER', nullable: false, tsType: 'number' },
        { name: 'name', dataType: 'TEXT', nullable: false, tsType: 'string' },
        { name: 'email', dataType: 'VARCHAR(255)', nullable: true, tsType: 'string' },
      ],
    },
    {
      name: 'posts',
      columns: [
        { name: 'id', dataType: 'INTEGER', nullable: false, tsType: 'number' },
        { name: 'user_id', dataType: 'INTEGER', nullable: false, tsType: 'number' },
        { name: 'title', dataType: 'TEXT', nullable: false, tsType: 'string' },
      ],
    },
  ],
}

/** The labels offered at the `|` of `query`, the rest of the query counting for the scope. */
function labels(query: string): string[] {
  const offset = query.indexOf('|')
  const text = query.replace('|', '')
  return completeSql(text.slice(0, offset), text, schema).items.map((item) => item.label)
}

const FUNCTIONS = [
  'COUNT(',
  'SUM(',
  'AVG(',
  'MIN(',
  'MAX(',
  'COALESCE(',
  'LOWER(',
  'UPPER(',
  'LENGTH(',
  'ROUND(',
  'CAST(',
]

describe('completeSql — the same grammar as the type-level completion', () => {
  it('starts a statement', () => {
    expect(labels('|')).toEqual(['SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'WITH'])
    expect(labels('sel|')).toEqual(['select'])
  })

  it('walks a SELECT', () => {
    expect(labels('SELECT |')).toEqual([
      'id',
      'name',
      'email',
      'id',
      'user_id',
      'title',
      '*',
      'DISTINCT',
      ...FUNCTIONS,
    ])
    expect(labels('SELECT id |')).toEqual(['FROM', 'AS'])
    expect(labels('SELECT id FROM |')).toEqual(['users', 'posts'])
    expect(labels('SELECT id FROM us|')).toEqual(['users'])
    expect(labels('SELECT id FROM users |')).toEqual([
      'WHERE',
      'JOIN',
      'LEFT JOIN',
      'INNER JOIN',
      'CROSS JOIN',
      'GROUP BY',
      'ORDER BY',
      'LIMIT',
      'AS',
    ])
    expect(labels('SELECT * FROM users u JOIN posts p |')).toEqual(['ON', 'USING', 'AS'])
    expect(labels('select co|')).toEqual(['count(', 'coalesce('])
  })

  it('walks conditions', () => {
    expect(labels('SELECT id FROM users WHERE |')).toEqual(['id', 'name', 'email', 'NOT', 'EXISTS'])
    expect(labels('SELECT id FROM users WHERE email |')).toEqual([
      '=',
      '<>',
      'IS NULL',
      'IS NOT NULL',
      'LIKE',
      'IN',
      'BETWEEN',
      'NOT',
    ])
    expect(labels('SELECT id FROM users WHERE email IS |')).toEqual(['NULL', 'NOT NULL'])
    expect(labels('SELECT id FROM users WHERE email IS NOT |')).toEqual(['NULL'])
    expect(labels('SELECT id FROM users WHERE email NOT |')).toEqual(['LIKE', 'IN', 'BETWEEN'])
    expect(labels('SELECT id FROM users WHERE id IN |')).toEqual([])
    expect(labels('SELECT id FROM users WHERE id = ? |')).toEqual([
      'AND',
      'OR',
      'GROUP BY',
      'ORDER BY',
      'LIMIT',
      'RETURNING',
    ])
    expect(labels('SELECT id FROM users WHERE id = ?|')).toEqual([])
    expect(labels('SELECT * FROM posts p JOIN users u ON u.|')).toEqual(['id', 'name', 'email'])
  })

  it('walks ORDER BY, INSERT, UPDATE and DELETE', () => {
    expect(labels('SELECT id FROM users ORDER BY name |')).toEqual(['ASC', 'DESC', 'LIMIT'])
    expect(labels('SELECT id FROM users LIMIT 10 |')).toEqual(['OFFSET'])
    expect(labels('INSERT INTO posts (|')).toEqual(['id', 'user_id', 'title'])
    expect(labels('INSERT INTO posts (user_id, title) |')).toEqual(['VALUES', 'SELECT'])
    expect(labels('UPDATE posts |')).toEqual(['SET'])
    expect(labels('UPDATE posts SET ti|')).toEqual(['title'])
    expect(labels('DELETE FROM posts |')).toEqual(['WHERE', 'RETURNING'])
  })
})

describe('completeSql — what only the cursor allows', () => {
  it('completes in the middle of a query, scoped by the tables after the cursor', () => {
    expect(labels('SELECT | FROM posts')).toEqual([
      'id',
      'user_id',
      'title',
      '*',
      'DISTINCT',
      ...FUNCTIONS,
    ])
    expect(labels('SELECT u.| FROM users u')).toEqual(['id', 'name', 'email'])
    expect(labels('SELECT id FROM | WHERE id = 1')).toEqual(['users', 'posts'])
    expect(labels('SELECT id FROM users WHERE em| = ?')).toEqual(['email'])
  })

  it('replaces only the word being typed', () => {
    expect(completeSql('SELECT id FROM us', 'SELECT id FROM us', schema).replace).toBe(2)
    expect(completeSql('SELECT u.na', 'SELECT u.na FROM users u', schema).replace).toBe(2)
  })

  it('describes each column and table with what the database says', () => {
    const [email] = completeSql(
      'SELECT id FROM users WHERE em',
      'SELECT id FROM users WHERE em',
      schema,
    ).items
    expect(email).toMatchObject({
      label: 'email',
      kind: 'column',
      detail: 'users · VARCHAR(255) → string | null',
    })
    expect(email?.documentation).toContain('| nullable | yes |')
    const [users] = completeSql('SELECT * FROM u', 'SELECT * FROM u', schema).items
    expect(users).toMatchObject({ label: 'users', kind: 'table', detail: 'table · 3 columns' })
    expect(users?.documentation).toContain('| email | `VARCHAR(255)` | `string | null` |')
  })
})
