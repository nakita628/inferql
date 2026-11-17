import { describe, expect, it } from 'vite-plus/test'

import { learnType, toTsType } from './postgres.js'

describe('toTsType', () => {
  it('mirrors what postgres.js returns at runtime', () => {
    expect(toTsType('int4')).toBe('number')
    expect(toTsType('int8')).toBe('string')
    expect(toTsType('bool')).toBe('boolean')
    expect(toTsType('timestamptz')).toBe('Date')
    expect(toTsType('jsonb')).toBe('unknown')
    expect(toTsType('bytea')).toBe('Buffer')
    expect(toTsType('hstore')).toBeUndefined()
  })
})

describe('learnType', () => {
  const types = new Map([
    [23, { oid: 23, typname: 'int4', typtype: 'b', typelem: 0 }],
    [1007, { oid: 1007, typname: '_int4', typtype: 'b', typelem: 23 }],
    [90_001, { oid: 90_001, typname: 'role', typtype: 'e', typelem: 0 }],
    [90_002, { oid: 90_002, typname: '_role', typtype: 'b', typelem: 90_001 }],
  ])
  const enums = new Map([[90_001, ['admin', 'member']]])

  it('learns enums as unions and arrays as element arrays', () => {
    expect(learnType(23, types, enums)).toBeUndefined()
    expect(learnType(1007, types, enums)).toBe('number[]')
    expect(learnType(90_001, types, enums)).toBe("'admin' | 'member'")
    expect(learnType(90_002, types, enums)).toBe("('admin' | 'member')[]")
    expect(learnType(1, types, enums)).toBeUndefined()
  })
})
