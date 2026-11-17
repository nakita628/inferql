/** The string literal the cursor is in, when it is the query argument of a `sql(...)` call. */
export type SqlLiteral = {
  /** Offset of the literal's first character, after its opening quote. */
  readonly start: number
  /** Offset of its closing quote, or the end of the source when it is not closed yet. */
  readonly end: number
  /** Its text from `start` to the cursor: what completion continues. */
  readonly before: string
  /** Its whole text, which also says what the rest of the query names (the tables in `FROM`). */
  readonly text: string
}

/**
 * `sql(` or `sql.as<Row>(` right before the literal. The call must start a name, so `mysql(`
 * or `db.sql(` are not taken; the type argument may be anything without a parenthesis.
 */
const CALL_BEFORE = /(?:^|[^\w$.])sql(?:\.as)?\s*(?:<[^()]*>)?\s*\(\s*$/u

type State = 'code' | 'line-comment' | 'block-comment' | 'string' | 'template'

/**
 * Finds the `sql(...)` literal the cursor at `offset` is in, scanning the source from its
 * start so that quotes inside comments, other strings and templates are not mistaken for one.
 * A template literal with a `${...}` before the cursor is not a query `sql()` can type, and is
 * not taken.
 */
export function findSqlLiteral(source: string, offset: number): SqlLiteral | undefined {
  let state: State = 'code'
  let quote = ''
  let opened = -1
  let substituted = false
  /** Open `${` of enclosing templates: on `}` at depth 0, the scan is back in that template. */
  const templates: number[] = []
  let braces = 0
  let index = 0
  while (index < offset) {
    const char = source.charAt(index)
    const next = source.charAt(index + 1)
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line-comment'
        index += 1
      } else if (char === '/' && next === '*') {
        state = 'block-comment'
        index += 1
      } else if (char === "'" || char === '"') {
        state = 'string'
        quote = char
        opened = index
      } else if (char === '`') {
        state = 'template'
        opened = index
        substituted = false
      } else if (char === '{') {
        braces += 1
      } else if (char === '}') {
        if (braces === 0 && templates.length > 0) {
          templates.pop()
          state = 'template'
          substituted = true
        } else {
          braces = Math.max(0, braces - 1)
        }
      }
    } else if (state === 'line-comment') {
      if (char === '\n') state = 'code'
    } else if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code'
        index += 1
      }
    } else if (state === 'string') {
      if (char === '\\') index += 1
      else if (char === quote || char === '\n') state = 'code'
    } else if (char === '\\') {
      index += 1
    } else if (char === '`') {
      state = 'code'
    } else if (char === '$' && next === '{') {
      templates.push(braces)
      braces = 0
      state = 'code'
      index += 1
    }
    index += 1
  }
  const isInLiteral = state === 'string' || (state === 'template' && !substituted)
  if (!isInLiteral || opened === -1) return undefined
  if (!CALL_BEFORE.test(source.slice(0, opened))) return undefined
  const start = opened + 1
  const end = closingQuote(source, offset, state === 'string' ? quote : '`')
  return { start, end, before: source.slice(start, offset), text: source.slice(start, end) }
}

/** The offset of the quote that closes the literal, scanning on from the cursor. */
function closingQuote(source: string, from: number, quote: string): number {
  let index = from
  while (index < source.length) {
    const char = source.charAt(index)
    if (char === '\\') {
      index += 2
    } else if (char === quote) {
      return index
    } else if (quote !== '`' && char === '\n') {
      return index
    } else if (quote === '`' && char === '$' && source.charAt(index + 1) === '{') {
      return index
    } else {
      index += 1
    }
  }
  return source.length
}

/**
 * Whether typing `typed` at the end of `before` (the literal's text up to the typed character)
 * starts a new word: a single letter or `_` after the start of the literal, a space or a
 * punctuation mark. VS Code does not open suggestions by itself inside a string, so the
 * extension opens them here — once per word: while the word goes on, the open list narrows.
 */
export function isWordStart(before: string, typed: string): boolean {
  if (!/^[A-Za-z_]$/u.test(typed)) return false
  const previous = before.at(-1)
  return previous === undefined || !/[\w$.]/u.test(previous) || previous === '.'
}
