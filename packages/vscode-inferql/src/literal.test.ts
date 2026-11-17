import { describe, expect, it } from 'vite-plus/test'

import { findSqlLiteral, isWordStart } from './literal.js'

/** Builds `${` in test sources without writing it inside a string, which lint reads as a slip. */
const DOLLAR = '$'

/** The literal at the `|` in `source`. */
function at(source: string) {
  const offset = source.indexOf('|')
  return findSqlLiteral(source.replace('|', ''), offset)
}

describe('findSqlLiteral', () => {
  it('finds the query literal of sql(...) in every quote style', () => {
    expect(at("sql('SELECT | FROM users')")).toEqual({
      start: 5,
      end: 23,
      before: 'SELECT ',
      text: 'SELECT  FROM users',
    })
    expect(at('query(sql(`SELECT id\n  FROM |`))')?.before).toBe('SELECT id\n  FROM ')
    expect(at('sql("SELECT |")')?.text).toBe('SELECT ')
    expect(at('sql.as<{ id: number }>(`SELECT |`)')?.before).toBe('SELECT ')
  })

  it('reads an unclosed literal to the end of the source', () => {
    expect(at('sql(`SELECT * FROM |')).toMatchObject({ before: 'SELECT * FROM ', end: 19 })
  })

  it('takes only the argument of sql itself', () => {
    expect(at("mysql('SELECT |')")).toBeUndefined()
    expect(at("db.sql('SELECT |')")).toBeUndefined()
    expect(at("log('SELECT |')")).toBeUndefined()
    expect(at("sql('a', 'SELECT |')")).toBeUndefined()
  })

  it('is not fooled by quotes in comments, other strings and templates', () => {
    expect(at("// sql('\nconst x = 'SELECT |'")).toBeUndefined()
    expect(at("/* ' */ sql(`SELECT |`)")?.before).toBe('SELECT ')
    expect(at(`const a = \`${DOLLAR}{sql('x')}\`; sql('SELECT |')`)?.before).toBe('SELECT ')
    expect(at('const s = "it\'s"; sql(`SELECT |`)')?.before).toBe('SELECT ')
  })

  it('does not take a template with a substitution before the cursor', () => {
    expect(at(`sql(\`SELECT ${DOLLAR}{col} FROM |\`)`)).toBeUndefined()
  })
})

describe('isWordStart', () => {
  it('is true for the first letter of a word anywhere in the query', () => {
    expect(isWordStart('', 'S')).toBe(true)
    expect(isWordStart('SELECT ', 'i')).toBe(true)
    expect(isWordStart('SELECT id,', 'n')).toBe(true)
    expect(isWordStart('SELECT count(', 'i')).toBe(true)
    expect(isWordStart('SELECT u.', 'n')).toBe(true)
    expect(isWordStart('SELECT  FROM users WHERE ', 'e')).toBe(true)
  })

  it('is false inside a word, and for what is not a letter', () => {
    expect(isWordStart('SELECT i', 'd')).toBe(false)
    expect(isWordStart('SELECT ', ' ')).toBe(false)
    expect(isWordStart('SELECT ', '1')).toBe(false)
    expect(isWordStart('SELECT ', 'ab')).toBe(false)
  })
})
