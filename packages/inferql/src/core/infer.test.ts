import { describe, expect, it } from 'vite-plus/test'

import type { DescribedColumn } from './dialect.js'
import { inferResultTarget, parseTypeText } from './infer.js'
import { printTarget } from './target.js'

const columns: readonly DescribedColumn[] = [
  { name: 'id', dataType: 'INTEGER', nullability: 'not-null', table: 'users', column: 'id' },
  { name: 'user_name', dataType: 'TEXT', nullability: 'nullable', table: 'users', column: 'name' },
  { name: 'total', dataType: null, nullability: 'unknown' },
]

function toTsType(dataType: string): string | undefined {
  return { INTEGER: 'number', TEXT: 'string' }[dataType]
}

describe('inferResultTarget', () => {
  it('builds the row type with null for nullable columns', () => {
    const result = inferResultTarget(columns, { toTsType })
    expect(printTarget(result.target)).toBe(
      '{ id: number; user_name: string | null; total: unknown }',
    )
    expect(result.unknownColumns).toEqual(['total'])
    expect(result.duplicateColumns).toEqual([])
  })

  it('prefers type overrides over the dialect mapping, case-insensitively', () => {
    const result = inferResultTarget(columns, {
      toTsType,
      overrides: { types: { integer: 'bigint' } },
    })
    expect(printTarget(result.target)).toBe(
      '{ id: bigint; user_name: string | null; total: unknown }',
    )
  })

  it('reports duplicate result columns', () => {
    const result = inferResultTarget(
      [
        { name: 'id', dataType: 'INTEGER', nullability: 'not-null' },
        { name: 'id', dataType: 'INTEGER', nullability: 'not-null' },
      ],
      { toTsType },
    )
    expect(result.duplicateColumns).toEqual(['id'])
  })
})

describe('parseTypeText', () => {
  it('reads unions, arrays and literals structurally', () => {
    expect(parseTypeText("'a' | 'b'")).toEqual({
      kind: 'union',
      value: [
        { kind: 'literal', value: "'a'" },
        { kind: 'literal', value: "'b'" },
      ],
    })
    expect(parseTypeText('string[]')).toEqual({
      kind: 'array',
      value: { kind: 'type', value: 'string' },
    })
    expect(parseTypeText("('a' | 'b')[]")).toEqual({
      kind: 'array',
      value: {
        kind: 'union',
        value: [
          { kind: 'literal', value: "'a'" },
          { kind: 'literal', value: "'b'" },
        ],
      },
    })
    expect(parseTypeText('Record<string, unknown>')).toEqual({
      kind: 'type',
      value: 'Record<string, unknown>',
    })
  })
})
