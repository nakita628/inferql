import { describe, expect, it } from 'vite-plus/test'

import {
  array,
  entry,
  isSameTarget,
  literal,
  normalizeTarget,
  object,
  printTarget,
  type,
  union,
} from './target.js'

describe('printTarget', () => {
  it('prints an object with nullable and optional members', () => {
    const target = object([
      entry('id', type('number')),
      entry('name', union([type('string'), type('null')])),
      entry('nick', type('string'), true),
      entry('a-b', type('string')),
    ])
    expect(printTarget(target)).toBe(
      '{ id: number; name: string | null; nick?: string; "a-b": string }',
    )
  })

  it('parenthesises a union inside an array', () => {
    expect(printTarget(array(union([literal("'a'"), literal("'b'")])))).toBe("('a' | 'b')[]")
    expect(printTarget(array(type('string')))).toBe('string[]')
    expect(printTarget(object([]))).toBe('{}')
  })
})

describe('normalizeTarget', () => {
  it('flattens, dedupes and sorts unions', () => {
    const target = union([type('null'), union([type('string'), type('null')])])
    expect(printTarget(normalizeTarget(target))).toBe('string | null')
  })

  it('keeps null and undefined last', () => {
    const target = union([type('undefined'), type('null'), type('number'), type('Date')])
    expect(printTarget(normalizeTarget(target))).toBe('Date | number | null | undefined')
  })

  it('collapses a single-member union', () => {
    expect(normalizeTarget(union([type('string')]))).toEqual(type('string'))
  })
})

describe('isSameTarget', () => {
  it('ignores union member order', () => {
    const a = object([entry('x', union([type('string'), type('null')]))])
    const b = object([entry('x', union([type('null'), type('string')]))])
    expect(isSameTarget(a, b)).toBe(true)
    expect(isSameTarget(a, object([entry('x', type('string'))]))).toBe(false)
  })
})
