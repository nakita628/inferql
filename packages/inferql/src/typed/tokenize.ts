/**
 * Splits a SQL string into tokens, at the type level. Identifiers and operators glued to
 * them (`a+b`) stay one token; whitespace, commas, parentheses, `?` and the comparison
 * operators split; a single-quoted literal is one token including its quotes; `t.*` is one
 * token so `SELECT t.*` keeps its meaning.
 *
 * TypeScript stops a tail-recursive type after 1000 steps, so a character-by-character walk
 * cannot read more than about a thousand characters. The text is cut into lines, each line
 * into words, and only a word is walked character by character: every loop then counts lines,
 * words or characters of one word, which keeps a whole migration file within reach.
 */
export type Tokenize<S extends string> = TokenizeLines<Segments<S, '\n'>, []>

type TokenizeLines<Lines extends string[], Acc extends string[]> = Lines extends [
  infer Line extends string,
  ...infer Rest extends string[],
]
  ? TokenizeWords<Segments<Line, ' '>, Acc> extends infer Next extends string[]
    ? TokenizeLines<Rest, Next>
    : Acc
  : Acc

type TokenizeWords<Words extends string[], Acc extends string[]> = Words extends [
  infer Word extends string,
  ...infer Rest extends string[],
]
  ? TokenizeWords<Rest, [...Acc, ...TokenizeImpl<Word, [], ''>]>
  : Acc

/** Whether `S` holds an odd number of `'`: a quoted literal opened and not yet closed. */
export type IsQuoteOpen<
  S extends string,
  Open extends boolean = false,
> = S extends `${string}'${infer Rest}` ? IsQuoteOpen<Rest, Open extends true ? false : true> : Open

/**
 * Splits `S` at every `Sep` that is not inside a single-quoted literal: a piece that leaves a
 * quote open is joined with the next one, separator included.
 */
export type Segments<
  S extends string,
  Sep extends string,
  Acc extends string[] = [],
  Pending extends string = '',
> = S extends `${infer Head}${Sep}${infer Rest}`
  ? IsQuoteOpen<`${Pending}${Head}`> extends true
    ? Segments<Rest, Sep, Acc, `${Pending}${Head}${Sep}`>
    : Segments<Rest, Sep, [...Acc, `${Pending}${Head}`]>
  : [...Acc, `${Pending}${S}`]

type Whitespace = ' ' | '\n' | '\t' | '\r'
type Single = ',' | '(' | ')' | '?' | ';'
type OperatorStart = '=' | '<' | '>' | '!'

type Flush<Acc extends string[], Current extends string> = Current extends ''
  ? Acc
  : [...Acc, Current]

type TokenizeImpl<
  S extends string,
  Acc extends string[],
  Current extends string,
> = S extends `${infer Char}${infer Rest}`
  ? Char extends Whitespace
    ? TokenizeImpl<Rest, Flush<Acc, Current>, ''>
    : Char extends Single
      ? TokenizeImpl<Rest, [...Flush<Acc, Current>, Char], ''>
      : Char extends '*'
        ? Current extends `${string}.`
          ? TokenizeImpl<Rest, [...Acc, `${Current}*`], ''>
          : TokenizeImpl<Rest, [...Flush<Acc, Current>, '*'], ''>
        : Char extends "'"
          ? Rest extends `${infer Literal}'${infer After}`
            ? TokenizeImpl<After, [...Flush<Acc, Current>, `'${Literal}'`], ''>
            : Flush<Acc, `${Current}'${Rest}`>
          : Char extends OperatorStart
            ? Rest extends `${infer Second extends '=' | '>'}${infer After}`
              ? TokenizeImpl<After, [...Flush<Acc, Current>, `${Char}${Second}`], ''>
              : TokenizeImpl<Rest, [...Flush<Acc, Current>, Char], ''>
            : TokenizeImpl<Rest, Acc, `${Current}${Char}`>
  : Flush<Acc, Current>

/** Strips `"..."` / `` `...` `` / `[...]` quoting from an identifier. */
type Backtick = '`'

export type Unquote<T extends string> = T extends `"${infer Inner}"`
  ? Inner
  : T extends `${Backtick}${infer Inner}${Backtick}`
    ? Inner
    : T extends `[${infer Inner}]`
      ? Inner
      : T

export type Upper<T extends string> = Uppercase<T>

export type Keyword =
  | 'SELECT'
  | 'FROM'
  | 'WHERE'
  | 'GROUP'
  | 'ORDER'
  | 'LIMIT'
  | 'OFFSET'
  | 'HAVING'
  | 'JOIN'
  | 'LEFT'
  | 'RIGHT'
  | 'INNER'
  | 'OUTER'
  | 'CROSS'
  | 'FULL'
  | 'NATURAL'
  | 'ON'
  | 'USING'
  | 'AS'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'IN'
  | 'IS'
  | 'NULL'
  | 'LIKE'
  | 'BY'
  | 'ASC'
  | 'DESC'
  | 'UNION'
  | 'DISTINCT'
  | 'ALL'
  | 'INSERT'
  | 'INTO'
  | 'VALUES'
  | 'UPDATE'
  | 'SET'
  | 'DELETE'
  | 'RETURNING'
  | 'CASE'
  | 'WHEN'
  | 'THEN'
  | 'ELSE'
  | 'END'
  | 'BETWEEN'
  | 'EXISTS'
  | 'WITH'

export type IsKeyword<T extends string> = Upper<T> extends Keyword ? true : false

/** A token that can serve as an identifier (a name, not punctuation, keyword or literal). */
export type IsIdentifier<T extends string> = T extends
  | ','
  | '('
  | ')'
  | '?'
  | ';'
  | '*'
  | `'${string}'`
  | `${number}`
  ? false
  : IsKeyword<T> extends true
    ? false
    : true

/** Splits tokens at depth-0 commas. */
export type SplitComma<
  T extends string[],
  Acc extends string[][] = [],
  Current extends string[] = [],
  Depth extends unknown[] = [],
> = T extends [infer Head extends string, ...infer Rest extends string[]]
  ? Head extends '('
    ? SplitComma<Rest, Acc, [...Current, Head], [...Depth, 0]>
    : Head extends ')'
      ? SplitComma<Rest, Acc, [...Current, Head], Depth extends [unknown, ...infer D] ? D : []>
      : Head extends ','
        ? Depth extends []
          ? SplitComma<Rest, [...Acc, Current], [], Depth>
          : SplitComma<Rest, Acc, [...Current, Head], Depth>
        : SplitComma<Rest, Acc, [...Current, Head], Depth>
  : Current extends []
    ? Acc
    : [...Acc, Current]

/**
 * Takes tokens until a depth-0 token whose uppercase form is in `Stop`; `rest` starts with
 * that token.
 */
export type TakeUntil<
  T extends string[],
  Stop extends string,
  Acc extends string[] = [],
  Depth extends unknown[] = [],
> = T extends [infer Head extends string, ...infer Rest extends string[]]
  ? Head extends '('
    ? TakeUntil<Rest, Stop, [...Acc, Head], [...Depth, 0]>
    : Head extends ')'
      ? TakeUntil<Rest, Stop, [...Acc, Head], Depth extends [unknown, ...infer D] ? D : []>
      : Depth extends []
        ? Upper<Head> extends Stop
          ? { readonly taken: Acc; readonly rest: T }
          : TakeUntil<Rest, Stop, [...Acc, Head], Depth>
        : TakeUntil<Rest, Stop, [...Acc, Head], Depth>
  : { readonly taken: Acc; readonly rest: [] }

/** Joins tokens back into text, the way a database names an unaliased expression column. */
export type JoinTokens<T extends string[], Acc extends string = ''> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? JoinTokens<Rest, `${Acc}${Head}`>
  : Acc
