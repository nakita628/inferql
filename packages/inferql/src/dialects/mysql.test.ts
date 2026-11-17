import { describe, expect, it } from 'vite-plus/test'

import { dataTypeOf, describeColumn, learnColumnType, toTsType } from './mysql.js'

describe('toTsType', () => {
  it('mirrors what mysql2 returns at runtime', () => {
    expect(toTsType('int')).toBe('number')
    expect(toTsType('BIGINT')).toBe('number')
    expect(toTsType('decimal')).toBe('string')
    expect(toTsType('varchar')).toBe('string')
    expect(toTsType('datetime')).toBe('Date')
    expect(toTsType('blob')).toBe('Buffer')
    expect(toTsType('json')).toBe('unknown')
    expect(toTsType('point')).toBeUndefined()
  })
})

describe('dataTypeOf', () => {
  it('tells TEXT from BLOB by the character set, and spots ENUM / SET flags', () => {
    expect(dataTypeOf({ name: 'a', columnType: 252, flags: 144, characterSet: 224 })).toBe('text')
    expect(dataTypeOf({ name: 'a', columnType: 252, flags: 144, characterSet: 63 })).toBe('blob')
    expect(dataTypeOf({ name: 'a', columnType: 254, flags: 257, characterSet: 224 })).toBe('enum')
    expect(dataTypeOf({ name: 'a', columnType: 254, flags: 2049, characterSet: 224 })).toBe('set')
    expect(dataTypeOf({ name: 'a', columnType: 253, flags: 0 })).toBe('varchar')
    expect(dataTypeOf({ name: 'a', columnType: 999, flags: 0 })).toBe('type_999')
  })
})

describe('describeColumn', () => {
  it('reads nullability from the NOT_NULL flag and drops empty sources', () => {
    expect(
      describeColumn({ name: 'id', columnType: 3, flags: 1, orgTable: 'users', orgName: 'id' }),
    ).toEqual({
      name: 'id',
      dataType: 'int',
      nullability: 'not-null',
      table: 'users',
      column: 'id',
    })
    expect(
      describeColumn({ name: 'total', columnType: 8, flags: 0, orgTable: '', orgName: '' }),
    ).toEqual({
      name: 'total',
      dataType: 'bigint',
      nullability: 'nullable',
      table: undefined,
      column: undefined,
    })
  })
})

describe('learnColumnType', () => {
  it('turns enum and set definitions into unions', () => {
    expect(learnColumnType("enum('admin','member')")).toBe("'admin' | 'member'")
    expect(learnColumnType("set('a','b')")).toBe("'a' | 'b'")
    expect(learnColumnType('varchar(255)')).toBeUndefined()
  })
})
