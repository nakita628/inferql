import { describe, expect, it } from 'vite-plus/test'

import { connectionsOf, matchesPattern } from './config.js'

describe('config helpers', () => {
  it('normalises one or many connections', () => {
    const one = { dialect: 'sqlite' }
    expect(connectionsOf({ connections: one })).toEqual([one])
    expect(connectionsOf({ connections: [one, one] })).toHaveLength(2)
  })

  it('matches string and regex patterns', () => {
    expect(matchesPattern('sql', 'sql')).toBe(true)
    expect(matchesPattern('sql', 'sqlx')).toBe(false)
    expect(matchesPattern({ regex: '^db\\.' }, 'db.query')).toBe(true)
  })
})
