import type { DescribedColumn } from './dialect.js'
import { array, entry, literal, object, type, union } from './target.js'
import type { ResolvedTarget } from './target.js'

export type TypeOverrides = {
  /** Dialect type name (case-insensitive) → TypeScript type, e.g. `{ timestamptz: 'string' }`. */
  readonly types?: Readonly<Record<string, string>> | undefined
}

export type InferOptions = {
  readonly toTsType: (dataType: string) => string | undefined
  readonly overrides?: TypeOverrides | undefined
}

export type InferResult = {
  readonly target: ResolvedTarget
  /** Columns whose type neither the dialect nor an override could name. */
  readonly unknownColumns: readonly string[]
  /** Result column names that appear more than once; TypeScript cannot express them. */
  readonly duplicateColumns: readonly string[]
}

function lookupOverride(
  overrides: Readonly<Record<string, string>> | undefined,
  key: string,
): string | undefined {
  if (overrides === undefined) return undefined
  const wanted = key.toLowerCase()
  for (const [name, value] of Object.entries(overrides)) {
    if (name.toLowerCase() === wanted) return value
  }
  return undefined
}

function columnType(column: DescribedColumn, options: InferOptions): string | undefined {
  if (column.dataType === null) return undefined
  return (
    lookupOverride(options.overrides?.types, column.dataType) ?? options.toTsType(column.dataType)
  )
}

/**
 * Builds the object type a row of the described columns has: `T | null` for a nullable
 * column, `unknown` for a type nobody could name.
 */
export function inferResultTarget(
  columns: readonly DescribedColumn[],
  options: InferOptions,
): InferResult {
  const unknownColumns: string[] = []
  const seen = new Set<string>()
  const duplicateColumns: string[] = []
  const members = columns.map((column) => {
    if (seen.has(column.name)) duplicateColumns.push(column.name)
    seen.add(column.name)
    const tsType = columnType(column, options)
    if (tsType === undefined) unknownColumns.push(column.name)
    const base = parseTypeText(tsType ?? 'unknown')
    return column.nullability === 'nullable'
      ? entry(column.name, union([base, type('null')]))
      : entry(column.name, base)
  })
  return { target: object(members), unknownColumns, duplicateColumns }
}

/**
 * Reads a TypeScript type written as text (from a dialect mapping or an override) into a
 * target, so `'a' | 'b'` and `string[]` compare structurally against an annotation. Anything
 * more elaborate is kept verbatim as a named type.
 */
export function parseTypeText(text: string): ResolvedTarget {
  const trimmed = text.trim()
  const members = splitTopLevel(trimmed, '|')
  if (members.length > 1) return union(members.map(parseTypeText))
  if (trimmed.startsWith('(') && trimmed.endsWith(')[]')) {
    return array(parseTypeText(trimmed.slice(1, -3)))
  }
  if (trimmed.endsWith('[]') && !trimmed.includes(' ')) {
    return array(parseTypeText(trimmed.slice(0, -2)))
  }
  if (/^(['"]).*\1$/su.test(trimmed) || /^-?\d+(\.\d+)?$/u.test(trimmed)) {
    return literal(trimmed)
  }
  return type(trimmed)
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
    } else if (char === '(' || char === '{' || char === '<' || char === '[') {
      depth += 1
    } else if (char === ')' || char === '}' || char === '>' || char === ']') {
      depth -= 1
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts.filter((part) => part.length > 0)
}
