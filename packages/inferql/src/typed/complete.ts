import type { HasTables } from './schema.js'
import type { ParseFrom, TableRef } from './tables.js'
import type { TakeUntil, Tokenize, Unquote, Upper } from './tokenize.js'

/**
 * Completion candidates for the query being typed, as string literal types: the text so far
 * with one more table, column or keyword appended. `sql()` takes `Q | Complete<Q, S>`, so an
 * editor offers these while the cursor is inside the string — through TypeScript's own string
 * literal completions, with no language service plugin, which is what keeps it working on the
 * native TypeScript 7 server (it has no plugin API).
 *
 * TypeScript hands the whole literal to the type, not the cursor position, so a candidate can
 * only extend the end of the text: typing a query from left to right is served, an edit in the
 * middle gets nothing new (never a wrong insertion). A partly typed word at the end narrows the
 * candidates to the names it starts, ignoring case.
 *
 * - after `FROM` / `JOIN` / `INTO` / `UPDATE` / `TABLE` (and `FROM a,`): table names;
 * - in the select list, `WHERE` / `AND` / `OR` / `ON` / `BY` / `SET` / `HAVING`, after a
 *   comparison or `INSERT INTO t (`: the columns of the tables in scope — every table while the
 *   select list is typed before its `FROM`;
 * - after `alias.`: the columns of that table;
 * - after a table in `FROM` / `JOIN`, or an item of the select list: the keywords that follow.
 */
export type Complete<Q extends string, S> = string extends Q
  ? never
  : HasTables<S> extends true
    ? CompleteAt<SplitEnd<Q, Tokenize<Q>>, Tokenize<Q>, S>
    : never

type Whitespace = ' ' | '\n' | '\t' | '\r'

/** The tokens a partly typed word cannot be: punctuation, literals, numbers, placeholders. */
type NotWord =
  | ','
  | '('
  | ')'
  | ';'
  | '*'
  | '?'
  | '='
  | '<'
  | '>'
  | '<>'
  | '!='
  | '<='
  | '>='
  | `'${string}`
  | `${number}`
  | `$${number}`
  | `:${string}`
  | `@${string}`

/**
 * Splits the text into what stays (`base`), the word being typed at its very end (`partial`,
 * empty after whitespace or punctuation) and the tokens before that word (`prev`).
 */
type SplitEnd<Q extends string, T extends string[]> = Q extends `${string}${Whitespace}`
  ? { readonly base: Q; readonly partial: ''; readonly prev: T }
  : T extends [...infer Init extends string[], infer Last extends string]
    ? Last extends NotWord
      ? Last extends GluedStart
        ? { readonly base: Q; readonly partial: ''; readonly prev: T }
        : // A value or `*` ends the text with no space after it: a word appended here would run
          // into it (`= ?AND`), so nothing is offered until a space is typed.
          never
      : Q extends `${infer Base}${Last}`
        ? { readonly base: Base; readonly partial: Last; readonly prev: Init }
        : never
    : { readonly base: Q; readonly partial: ''; readonly prev: [] }

/** The tokens a name may follow with no space: `(a`, `a, b`, `id=1`. */
type GluedStart = '(' | ',' | '=' | '<>' | '!=' | '<' | '>' | '<=' | '>='

type CompleteAt<At, T extends string[], S> = At extends {
  readonly base: infer Base extends string
  readonly partial: infer Partial extends string
  readonly prev: infer Prev extends string[]
}
  ? Partial extends `${infer Alias}.${infer Rest}`
    ? Candidates<`${Base}${Alias}.`, Rest, ColumnsOf<AliasTable<Unquote<Alias>, T, S>, S>>
    : Candidates<Base, Partial, Names<Context<Prev, T>, Prev, T, S, KeywordCase<T>>>
  : never

/** `Base + name` for every name that starts with what is typed, ignoring case. */
type Candidates<
  Base extends string,
  Partial extends string,
  Offered extends string,
> = Offered extends unknown
  ? Lowercase<Offered> extends `${Lowercase<Partial>}${string}`
    ? `${Base}${Offered}`
    : never
  : never

// --- where the cursor is --------------------------------------------------------------------

type TableWord = 'FROM' | 'JOIN' | 'INTO' | 'UPDATE' | 'TABLE'

type ComparisonWord = '=' | '<>' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'ILIKE' | 'BETWEEN'

/** Words after which a condition starts: a column (or `NOT` / `EXISTS`) comes next. */
type ConditionStart = 'WHERE' | 'AND' | 'OR' | 'ON' | 'HAVING' | 'NOT' | '('

type ClauseWord =
  | 'SELECT'
  | 'FROM'
  | 'JOIN'
  | 'WHERE'
  | 'GROUP'
  | 'ORDER'
  | 'HAVING'
  | 'LIMIT'
  | 'OFFSET'
  | 'SET'
  | 'INTO'
  | 'UPDATE'
  | 'VALUES'
  | 'ON'
  | 'RETURNING'

/** The last clause keyword before the cursor, which says what a `,` or a word continues. */
type Clause<Prev extends string[]> = Prev extends [
  ...infer Init extends string[],
  infer Last extends string,
]
  ? Upper<Last> extends ClauseWord
    ? Upper<Last>
    : Clause<Init>
  : never

/** The statement's verb: its first token. */
type StatementVerb<T extends string[]> = T extends [infer First extends string, ...string[]]
  ? Upper<First>
  : never

type ContextKind =
  | 'start'
  | 'table'
  | 'column'
  | 'selectList'
  | 'afterSelectItem'
  | 'afterTable'
  | 'afterJoinTable'
  | 'condition'
  | 'afterOperand'
  | 'afterCondition'
  | 'afterOrderItem'
  | 'afterGroupItem'
  | 'afterLimit'
  | 'insert'
  | 'afterInsertTable'
  | 'afterInsertColumns'
  | 'afterValues'
  | 'afterUpdateTable'
  | 'afterSetItem'
  | 'delete'
  | 'afterDeleteTable'
  | 'returning'
  | 'afterIs'
  | 'afterIsNot'
  | 'afterNot'
  | 'none'

/** A token that ends a value: a literal, a number, a placeholder, `NULL`, `)`. */
type IsValueEnd<Last extends string> = Last extends
  | `'${string}`
  | `${number}`
  | '?'
  | `$${number}`
  | `:${string}`
  | `@${string}`
  | ')'
  ? true
  : Upper<Last> extends 'NULL' | 'TRUE' | 'FALSE'
    ? true
    : false

type Context<Prev extends string[], T extends string[]> = Prev extends []
  ? 'start'
  : Prev extends [...infer Init extends string[], infer Last extends string]
    ? Upper<Last> extends 'SELECT'
      ? 'selectList'
      : Upper<Last> extends 'DISTINCT'
        ? 'column'
        : Upper<Last> extends 'INSERT'
          ? 'insert'
          : Upper<Last> extends 'DELETE'
            ? 'delete'
            : Upper<Last> extends TableWord
              ? 'table'
              : Upper<Last> extends 'IS'
                ? 'afterIs'
                : Upper<Last> extends 'IN'
                  ? 'none'
                  : Upper<Last> extends 'NOT'
                    ? AfterNot<Init>
                    : Upper<Last> extends ConditionStart
                      ? Last extends '('
                        ? Clause<Init> extends 'INTO'
                          ? 'column'
                          : Clause<Init> extends 'WHERE' | 'ON' | 'HAVING'
                            ? 'condition'
                            : 'none'
                        : 'condition'
                      : Upper<Last> extends ComparisonWord
                        ? 'column'
                        : Upper<Last> extends 'BY' | 'SET'
                          ? 'column'
                          : Upper<Last> extends 'RETURNING'
                            ? 'returning'
                            : Last extends ','
                              ? AfterComma<Clause<Init>>
                              : AfterWord<Last, Init, Prev, T>
    : 'none'

/** `IS NOT` wants `NULL`; `col NOT` wants `LIKE` / `IN` / `BETWEEN`; a leading `NOT` a condition. */
type AfterNot<Init extends string[]> = Init extends [...string[], infer Before extends string]
  ? Upper<Before> extends 'IS'
    ? 'afterIsNot'
    : Upper<Before> extends ConditionStart | ClauseWord
      ? 'condition'
      : Before extends NotWord
        ? 'condition'
        : 'afterNot'
  : 'condition'

/** What a `,` continues: another table, select item, column or assignment. */
type AfterComma<C> = C extends 'FROM'
  ? 'table'
  : C extends 'SELECT'
    ? 'selectList'
    : C extends 'GROUP' | 'ORDER' | 'SET' | 'RETURNING' | 'INTO'
      ? 'column'
      : 'none'

/** After a name or a value: the clause it sits in says what may follow. */
type AfterWord<
  Last extends string,
  Init extends string[],
  Prev extends string[],
  T extends string[],
> =
  Clause<Prev> extends 'SELECT'
    ? Last extends ',' | '('
      ? 'none'
      : 'afterSelectItem'
    : Clause<Prev> extends 'FROM'
      ? StatementVerb<T> extends 'DELETE'
        ? 'afterDeleteTable'
        : 'afterTable'
      : Clause<Prev> extends 'JOIN'
        ? 'afterJoinTable'
        : Clause<Prev> extends 'WHERE' | 'ON' | 'HAVING'
          ? IsValueEnd<Last> extends true
            ? 'afterCondition'
            : Init extends [...string[], infer Before extends string]
              ? Upper<Before> extends ComparisonWord
                ? 'afterCondition'
                : 'afterOperand'
              : 'afterOperand'
          : Clause<Prev> extends 'ORDER'
            ? 'afterOrderItem'
            : Clause<Prev> extends 'GROUP'
              ? 'afterGroupItem'
              : Clause<Prev> extends 'LIMIT' | 'OFFSET'
                ? 'afterLimit'
                : Clause<Prev> extends 'INTO'
                  ? Last extends ')'
                    ? 'afterInsertColumns'
                    : 'afterInsertTable'
                  : Clause<Prev> extends 'VALUES'
                    ? Last extends ')'
                      ? 'afterValues'
                      : 'none'
                    : Clause<Prev> extends 'UPDATE'
                      ? 'afterUpdateTable'
                      : Clause<Prev> extends 'SET'
                        ? IsValueEnd<Last> extends true
                          ? 'afterSetItem'
                          : 'none'
                        : 'none'

// --- what to offer --------------------------------------------------------------------------

/** The functions the row type understands (`expr.ts`), offered with their parenthesis. */
type FunctionName =
  | 'COUNT('
  | 'SUM('
  | 'AVG('
  | 'MIN('
  | 'MAX('
  | 'COALESCE('
  | 'LOWER('
  | 'UPPER('
  | 'LENGTH('
  | 'ROUND('
  | 'CAST('

/** What may follow a finished condition in `WHERE` / `HAVING`. */
type AfterConditionWord = 'AND' | 'OR' | 'GROUP BY' | 'ORDER BY' | 'LIMIT' | 'RETURNING'

type Names<
  Kind extends ContextKind,
  Prev extends string[],
  T extends string[],
  S,
  Case extends 'upper' | 'lower',
> = Kind extends 'table'
  ? keyof S & string
  : Kind extends 'column'
    ? ColumnsOf<TablesInScope<T, S>, S>
    : Kind extends 'selectList'
      ? ColumnsOf<TablesInScope<T, S>, S> | '*' | Keyword<'DISTINCT' | FunctionName, Case>
      : Kind extends 'condition'
        ? ColumnsOf<TablesInScope<T, S>, S> | Keyword<'NOT' | 'EXISTS', Case>
        : Kind extends 'returning'
          ? ColumnsOf<TablesInScope<T, S>, S> | '*'
          : Keyword<KeywordsAfter<Kind, Prev>, Case>

/** The keywords each position offers. */
type KeywordsAfter<Kind extends ContextKind, Prev extends string[]> = Kind extends 'start'
  ? 'SELECT' | 'INSERT INTO' | 'UPDATE' | 'DELETE FROM' | 'WITH'
  : Kind extends 'afterSelectItem'
    ? 'FROM' | 'AS'
    : Kind extends 'afterTable'
      ?
          | 'WHERE'
          | 'JOIN'
          | 'LEFT JOIN'
          | 'INNER JOIN'
          | 'CROSS JOIN'
          | 'GROUP BY'
          | 'ORDER BY'
          | 'LIMIT'
          | 'AS'
      : Kind extends 'afterJoinTable'
        ? 'ON' | 'USING' | 'AS'
        : Kind extends 'afterOperand'
          ? '=' | '<>' | 'IS NULL' | 'IS NOT NULL' | 'LIKE' | 'IN' | 'BETWEEN' | 'NOT'
          : Kind extends 'afterCondition'
            ? Clause<Prev> extends 'ON'
              ? 'AND' | 'OR' | 'WHERE' | 'JOIN' | 'LEFT JOIN' | 'ORDER BY' | 'LIMIT'
              : Clause<Prev> extends 'HAVING'
                ? 'AND' | 'OR' | 'ORDER BY' | 'LIMIT'
                : AfterConditionWord
            : Kind extends 'afterOrderItem'
              ? 'ASC' | 'DESC' | 'LIMIT'
              : Kind extends 'afterGroupItem'
                ? 'HAVING' | 'ORDER BY' | 'LIMIT'
                : Kind extends 'afterLimit'
                  ? 'OFFSET'
                  : Kind extends 'insert'
                    ? 'INTO'
                    : Kind extends 'afterInsertTable'
                      ? 'VALUES' | 'SELECT' | 'DEFAULT VALUES'
                      : Kind extends 'afterInsertColumns'
                        ? 'VALUES' | 'SELECT'
                        : Kind extends 'afterValues'
                          ? 'RETURNING'
                          : Kind extends 'afterUpdateTable'
                            ? 'SET'
                            : Kind extends 'afterSetItem'
                              ? 'WHERE' | 'RETURNING'
                              : Kind extends 'delete'
                                ? 'FROM'
                                : Kind extends 'afterDeleteTable'
                                  ? 'WHERE' | 'RETURNING'
                                  : Kind extends 'afterIs'
                                    ? 'NULL' | 'NOT NULL'
                                    : Kind extends 'afterIsNot'
                                      ? 'NULL'
                                      : Kind extends 'afterNot'
                                        ? 'LIKE' | 'IN' | 'BETWEEN'
                                        : never

/** Keywords in the case the query is written in (`select ...` gets `from`). */
type KeywordCase<T extends string[]> = T extends [infer First extends string, ...string[]]
  ? First extends Lowercase<First>
    ? 'lower'
    : 'upper'
  : 'upper'

type Keyword<K extends string, Case extends 'upper' | 'lower'> = Case extends 'lower'
  ? Lowercase<K>
  : K

type ColumnsOf<Tables, S> = Tables extends keyof S ? keyof S[Tables] & string : never

/**
 * The tables whose columns the cursor can name: those in `FROM` / `JOIN` once written, the
 * target of `UPDATE` / `INSERT INTO`, or — in a select list typed before its `FROM` — all.
 */
type TablesInScope<T extends string[], S> = TakeUntil<T, 'FROM'>['rest'] extends [
  string,
  ...infer FromTokens extends string[],
]
  ? ParseFrom<FromTokens> extends { readonly tables: infer Refs extends TableRef[] }
    ? Refs[number]['table']
    : keyof S
  : TargetTable<T> extends infer Target extends string
    ? [Target] extends [never]
      ? keyof S
      : Target
    : keyof S

/** `UPDATE t ...` / `INSERT INTO t ...` / `DELETE FROM t` → `t`. */
type TargetTable<T extends string[]> = T extends [
  infer Verb extends string,
  infer Second extends string,
  ...infer Rest extends string[],
]
  ? Upper<Verb> extends 'UPDATE'
    ? Unquote<Second>
    : Upper<Verb> extends 'INSERT'
      ? Rest extends [infer Table extends string, ...string[]]
        ? Unquote<Table>
        : never
      : never
  : never

/** The table an alias stands for, or the table of that name before `FROM` is written. */
type AliasTable<Alias extends string, T extends string[], S> = TakeUntil<
  T,
  'FROM'
>['rest'] extends [string, ...infer FromTokens extends string[]]
  ? ParseFrom<FromTokens> extends { readonly tables: infer Refs extends TableRef[] }
    ? Extract<Refs[number], { readonly alias: Alias }>['table']
    : never
  : Alias extends keyof S
    ? Alias
    : never
