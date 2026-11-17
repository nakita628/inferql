import type { ParseTokens } from './parse.js'
import type { Column } from './schema.js'
import type { IsQuoteOpen, SplitComma, TakeUntil, Tokenize, Unquote, Upper } from './tokenize.js'

/**
 * The `Schema` that `CREATE TABLE` / `ALTER TABLE` / `DROP TABLE` statements build, read at the
 * type level from the DDL text itself, so no file has to be generated:
 *
 * ```ts
 * import type users from '../migrations/001_users.js' // export default `CREATE TABLE ...`
 * declare module 'inferql' {
 *   interface Schema extends InferSchema<'sqlite', [typeof users]> {}
 * }
 * ```
 *
 * `DDL` is one string or a list of them, applied in order — one per migration. Column types
 * map to TypeScript the way the dialect's driver returns them (the same table `inferql schema`
 * uses), `Overrides` replaces that for a database type name, as `--override` does.
 *
 * A statement that changes a table in a way this parser does not follow leaves the table with
 * `unknown` columns rather than a guessed shape. Statements that do not change any table shape
 * (indexes, triggers, inserts, transactions) are skipped.
 */
export type InferSchema<
  D extends DialectName,
  DDL extends string | readonly string[],
  Overrides extends Readonly<Record<string, unknown>> = Record<never, never>,
> =
  ApplySources<
    DDL extends string ? [DDL] : DDL,
    EmptyState,
    Family<D>,
    Overrides
  > extends infer St extends State
    ? ResolveSchema<St, Family<D>, Overrides>
    : never

/** The dialect names `InferSchema` understands; the same names the lint rule accepts. */
export type DialectName = 'sqlite' | 'mysql' | 'mariadb' | 'postgres' | 'postgresql' | 'pg'

type FamilyName = 'sqlite' | 'mysql' | 'postgres'

type Family<D extends DialectName> = D extends 'mysql' | 'mariadb'
  ? 'mysql'
  : D extends 'postgres' | 'postgresql' | 'pg'
    ? 'postgres'
    : 'sqlite'

// --- state ----------------------------------------------------------------------------------

/**
 * A column while the statements are applied: its type as the database names it (resolved to
 * TypeScript only at the end, so `ALTER TYPE ... ADD VALUE` still reaches earlier tables), or a
 * TypeScript type already known (an inline `ENUM(...)`, a view column).
 */
type RawType = string | { readonly ts: unknown }

type ColumnState = { readonly type: RawType; readonly nullable: boolean }

type TableState = { readonly [column: string]: ColumnState }

/** A named type: an enum's values, or a domain over another type. */
type TypeEntry = { readonly ts: unknown } | { readonly domain: RawType }

type State = {
  readonly tables: { readonly [table: string]: TableState }
  /** Tables changed in a way the parser cannot follow; their columns resolve to `unknown`. */
  readonly opaque: string
  readonly types: { readonly [name: string]: TypeEntry }
}

/** An object type with no keys. */
type Empty = Record<never, never>

type EmptyState = { tables: Empty; opaque: never; types: Empty }

type SetKey<O, K extends string, V> = { [P in keyof O | K]: P extends K ? V : O[P & keyof O] }

type DropKey<O, K extends string> = { [P in keyof O as P extends K ? never : P]: O[P] }

type WithTable<St extends State, Name extends string, Columns> = {
  tables: SetKey<St['tables'], Name, Columns>
  opaque: Exclude<St['opaque'], Name>
  types: St['types']
}

type WithOpaque<St extends State, Name extends string> = {
  tables: SetKey<St['tables'], Name, Empty>
  opaque: St['opaque'] | Name
  types: St['types']
}

type WithoutTables<St extends State, Names extends string> = {
  tables: DropKey<St['tables'], Names>
  opaque: Exclude<St['opaque'], Names>
  types: St['types']
}

type WithType<St extends State, Name extends string, Entry extends TypeEntry> = {
  tables: St['tables']
  opaque: St['opaque']
  types: SetKey<St['types'], Name, Entry>
}

type WithoutTypes<St extends State, Names extends string> = {
  tables: St['tables']
  opaque: St['opaque']
  types: DropKey<St['types'], Names>
}

type HasTable<St extends State, Name extends string> = Name extends keyof St['tables']
  ? true
  : false

// --- text → statements ----------------------------------------------------------------------

/** Removes `/* ... *\/` comments; an unclosed one is left alone rather than eating the rest. */
type StripBlockComments<
  S extends string,
  Acc extends string = '',
> = S extends `${infer Before}/*${infer After}`
  ? After extends `${string}*/${infer Rest}`
    ? StripBlockComments<Rest, `${Acc}${Before} `>
    : `${Acc}${S}`
  : `${Acc}${S}`

/** Removes `-- ...` comments up to the end of their line. */
type StripLineComments<
  S extends string,
  Acc extends string = '',
> = S extends `${infer Before}--${infer After}`
  ? After extends `${string}\n${infer Rest}`
    ? StripLineComments<Rest, `${Acc}${Before}\n`>
    : `${Acc}${Before}`
  : `${Acc}${S}`

/** Whether `S` holds an odd number of `$$`: a PostgreSQL function body opened, not closed. */
type IsDollarOpen<
  S extends string,
  Open extends boolean = false,
> = S extends `${string}$$${infer Rest}`
  ? IsDollarOpen<Rest, Open extends true ? false : true>
  : Open

/** Splits at `;` outside quoted literals and `$$` bodies. */
type SplitStatements<
  S extends string,
  Acc extends string[] = [],
  Pending extends string = '',
> = S extends `${infer Head};${infer Rest}`
  ? IsQuoteOpen<`${Pending}${Head}`> extends true
    ? SplitStatements<Rest, Acc, `${Pending}${Head};`>
    : IsDollarOpen<`${Pending}${Head}`> extends true
      ? SplitStatements<Rest, Acc, `${Pending}${Head};`>
      : SplitStatements<Rest, [...Acc, `${Pending}${Head}`]>
  : [...Acc, `${Pending}${S}`]

type Statements<S extends string> = SplitStatements<StripLineComments<StripBlockComments<S>>>

// --- applying statements --------------------------------------------------------------------

type ApplySources<
  Sources extends readonly string[],
  St extends State,
  F extends FamilyName,
  O,
> = Sources extends readonly [infer Head extends string, ...infer Rest extends readonly string[]]
  ? string extends Head
    ? EmptyState
    : ApplyStatements<Statements<Head>, St, F, O> extends infer Next extends State
      ? ApplySources<Rest, Next, F, O>
      : St
  : St

type ApplyStatements<
  List extends string[],
  St extends State,
  F extends FamilyName,
  O,
> = List extends [infer Head extends string, ...infer Rest extends string[]]
  ? Apply<Tokenize<Head>, St, F, O> extends infer Next extends State
    ? ApplyStatements<Rest, Next, F, O>
    : St
  : St

type Apply<T extends string[], St extends State, F extends FamilyName, O> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Upper<Head> extends 'CREATE'
    ? ApplyCreate<Rest, St, F, O>
    : Upper<Head> extends 'DROP'
      ? ApplyDrop<Rest, St, F>
      : Upper<Head> extends 'ALTER'
        ? ApplyAlter<Rest, St, F>
        : Upper<Head> extends 'RENAME'
          ? ApplyRenameTables<Rest, St, F>
          : St
  : St

// --- identifiers ----------------------------------------------------------------------------

type LastSegment<S extends string> = S extends `${string}.${infer Rest}` ? LastSegment<Rest> : S

/**
 * A table, column or type name as the database stores it: unquoted, without its schema, and —
 * on PostgreSQL — folded to lower case unless it was quoted.
 */
type Ident<Name extends string, F extends FamilyName> =
  LastSegment<Name> extends infer Last extends string
    ? F extends 'postgres'
      ? Last extends `"${string}"`
        ? Unquote<Last>
        : Lowercase<Last>
      : Unquote<Last>
    : never

type IdentList<Groups extends string[][], F extends FamilyName> = {
  [K in keyof Groups]: Groups[K] extends [infer Name extends string, ...string[]]
    ? Ident<Name, F>
    : never
}[number]

type SkipIfExists<T extends string[]> = T extends [
  infer If extends string,
  infer Exists extends string,
  ...infer Rest extends string[],
]
  ? Upper<If> extends 'IF'
    ? Upper<Exists> extends 'EXISTS'
      ? { readonly found: true; readonly rest: Rest }
      : { readonly found: false; readonly rest: T }
    : { readonly found: false; readonly rest: T }
  : { readonly found: false; readonly rest: T }

type SkipIfNotExists<T extends string[]> = T extends [
  infer If extends string,
  infer Not extends string,
  infer Exists extends string,
  ...infer Rest extends string[],
]
  ? [Upper<If>, Upper<Not>, Upper<Exists>] extends ['IF', 'NOT', 'EXISTS']
    ? { readonly found: true; readonly rest: Rest }
    : { readonly found: false; readonly rest: T }
  : { readonly found: false; readonly rest: T }

type SkipWords<T extends string[], Words extends string> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Upper<Head> extends Words
    ? SkipWords<Rest, Words>
    : T
  : T

/** Splits `( ... ) rest` at the matching close parenthesis (the leading `(` already consumed). */
type GroupEnd<
  T extends string[],
  Acc extends string[] = [],
  Depth extends unknown[] = [],
> = T extends [infer Head extends string, ...infer Rest extends string[]]
  ? Head extends '('
    ? GroupEnd<Rest, [...Acc, Head], [...Depth, 0]>
    : Head extends ')'
      ? Depth extends []
        ? { readonly group: Acc; readonly rest: Rest }
        : GroupEnd<Rest, [...Acc, Head], Depth extends [unknown, ...infer D] ? D : []>
      : GroupEnd<Rest, [...Acc, Head], Depth>
  : { readonly group: Acc; readonly rest: [] }

/** Whether a depth-0 token of `T` is in `Words`. */
type HasWord<T extends string[], Words extends string> = TakeUntil<T, Words>['rest'] extends []
  ? false
  : true

// --- CREATE ---------------------------------------------------------------------------------

type ApplyCreate<T extends string[], St extends State, F extends FamilyName, O> =
  SkipWords<T, 'OR' | 'REPLACE' | 'TEMP' | 'TEMPORARY' | 'UNLOGGED' | 'GLOBAL' | 'LOCAL'> extends [
    infer Kind extends string,
    ...infer Rest extends string[],
  ]
    ? Upper<Kind> extends 'TABLE'
      ? CreateTable<Rest, St, F>
      : Upper<Kind> extends 'TYPE'
        ? CreateType<Rest, St, F>
        : Upper<Kind> extends 'DOMAIN'
          ? CreateDomain<Rest, St, F>
          : CreateView<T, St, F, O>
    : St

type CreateTable<T extends string[], St extends State, F extends FamilyName> =
  SkipIfNotExists<T> extends {
    readonly found: infer IfNotExists extends boolean
    readonly rest: [infer RawName extends string, ...infer Rest extends string[]]
  }
    ? Ident<RawName, F> extends infer Name extends string
      ? IfNotExists extends true
        ? HasTable<St, Name> extends true
          ? St
          : CreateTableBody<Name, Rest, St, F>
        : CreateTableBody<Name, Rest, St, F>
      : St
    : St

type CreateTableBody<
  Name extends string,
  T extends string[],
  St extends State,
  F extends FamilyName,
> = T extends ['(', ...infer AfterParen extends string[]]
  ? GroupEnd<AfterParen> extends {
      readonly group: infer Body extends string[]
      readonly rest: infer After extends string[]
    }
    ? HasWord<After, 'AS' | 'INHERITS' | 'SELECT'> extends true
      ? WithOpaque<St, Name>
      : TableColumns<SplitComma<Body>, F> extends infer Columns
        ? Columns extends TableState
          ? WithTable<St, Name, Columns>
          : WithOpaque<St, Name>
        : never
    : WithOpaque<St, Name>
  : T extends [infer Like extends string, infer Source extends string, ...string[]]
    ? Upper<Like> extends 'LIKE'
      ? Ident<Source, F> extends infer SourceName extends string
        ? HasTable<St, SourceName> extends true
          ? SourceName extends St['opaque']
            ? WithOpaque<St, Name>
            : WithTable<St, Name, St['tables'][SourceName]>
          : WithOpaque<St, Name>
        : never
      : WithOpaque<St, Name>
    : WithOpaque<St, Name>

type TableConstraintWord =
  | 'CONSTRAINT'
  | 'PRIMARY'
  | 'UNIQUE'
  | 'FOREIGN'
  | 'CHECK'
  | 'KEY'
  | 'INDEX'
  | 'FULLTEXT'
  | 'SPATIAL'
  | 'EXCLUDE'

/** The columns of a `CREATE TABLE (...)` body, or `false` when a definition is not understood. */
type TableColumns<Defs extends string[][], F extends FamilyName> =
  CollectColumns<Defs, F, Empty> extends infer Columns
    ? Columns extends TableState
      ? MarkNotNull<Columns, PrimaryKeyColumns<Defs, F>>
      : false
    : false

type CollectColumns<Defs extends string[][], F extends FamilyName, Acc> = Defs extends [
  infer Def extends string[],
  ...infer Rest extends string[][],
]
  ? Def extends [infer First extends string, ...string[]]
    ? Upper<First> extends TableConstraintWord
      ? CollectColumns<Rest, F, Acc>
      : Upper<First> extends 'LIKE' | 'PERIOD'
        ? false
        : ColumnDefinition<Def, F> extends {
              readonly name: infer Name extends string
              readonly column: infer C
            }
          ? CollectColumns<Rest, F, SetKey<Acc, Name, C>>
          : false
    : CollectColumns<Rest, F, Acc>
  : Acc

/** The columns named by a table-level `PRIMARY KEY (...)`, which are implicitly NOT NULL. */
type PrimaryKeyColumns<Defs extends string[][], F extends FamilyName> = {
  [K in keyof Defs]: Defs[K] extends string[] ? PrimaryKeyOf<Defs[K], F> : never
}[number]

type PrimaryKeyOf<Def extends string[], F extends FamilyName> = TakeUntil<
  Def,
  'PRIMARY'
>['rest'] extends [string, infer Key extends string, '(', ...infer Rest extends string[]]
  ? Upper<Key> extends 'KEY'
    ? IdentList<SplitComma<GroupEnd<Rest>['group']>, F>
    : never
  : never

type MarkNotNull<Columns extends TableState, Names> = {
  [C in keyof Columns]: C extends Names ? { type: Columns[C]['type']; nullable: false } : Columns[C]
}

/** Words that end a column's type and start its constraints. */
type ConstraintWord =
  | 'CONSTRAINT'
  | 'NOT'
  | 'NULL'
  | 'PRIMARY'
  | 'UNIQUE'
  | 'CHECK'
  | 'DEFAULT'
  | 'REFERENCES'
  | 'COLLATE'
  | 'GENERATED'
  | 'AS'
  | 'AUTO_INCREMENT'
  | 'AUTOINCREMENT'
  | 'COMMENT'
  | 'ON'
  | 'KEY'
  | 'IDENTITY'
  | 'CHARACTER'
  | 'CHARSET'
  | 'SRID'
  | 'INVISIBLE'
  | 'VISIBLE'
  | 'STORED'
  | 'VIRTUAL'
  | 'COLUMN_FORMAT'
  | 'STORAGE'
  | 'USING'

/** `name type constraints...` → the column's name and state; `false` when not understood. */
type ColumnDefinition<Def extends string[], F extends FamilyName> = Def extends [
  infer RawName extends string,
  ...infer Rest extends string[],
]
  ? RawName extends '(' | ')' | ','
    ? false
    : Rest extends [infer First extends string, ...infer AfterFirst extends string[]]
      ? Upper<First> extends Exclude<ConstraintWord, 'CHARACTER'>
        ? MakeColumn<RawName, [], Rest, F>
        : TakeUntil<AfterFirst, ConstraintWord> extends {
              readonly taken: infer TypeRest extends string[]
              readonly rest: infer Constraints extends string[]
            }
          ? MakeColumn<RawName, [First, ...TypeRest], Constraints, F>
          : false
      : MakeColumn<RawName, [], [], F>
  : false

type MakeColumn<
  RawName extends string,
  TypeTokens extends string[],
  Constraints extends string[],
  F extends FamilyName,
> = {
  readonly name: Ident<RawName, F>
  readonly column: {
    type: RawTypeOf<TypeTokens, F>
    nullable: IsNotNull<Constraints> extends true
      ? false
      : ImpliesNotNull<TypeTokens, F> extends true
        ? false
        : true
  }
}

/**
 * Whether the constraints make a column NOT NULL: `NOT NULL`, `PRIMARY KEY` (implied on MySQL
 * and PostgreSQL; on SQLite, `inferql schema` reports a key column as not null too) or
 * PostgreSQL's `GENERATED ... AS IDENTITY`. Tokens inside parentheses (`CHECK (x IS NOT NULL)`)
 * do not count.
 */
type IsNotNull<T extends string[], Depth extends unknown[] = []> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Head extends '('
    ? IsNotNull<Rest, [...Depth, 0]>
    : Head extends ')'
      ? IsNotNull<Rest, Depth extends [unknown, ...infer D] ? D : []>
      : Depth extends []
        ? Upper<Head> extends 'PRIMARY' | 'IDENTITY'
          ? true
          : Upper<Head> extends 'NOT'
            ? Rest extends [infer Next extends string, ...string[]]
              ? Upper<Next> extends 'NULL'
                ? true
                : IsNotNull<Rest, Depth>
              : false
            : IsNotNull<Rest, Depth>
        : IsNotNull<Rest, Depth>
  : false

/** `serial` types carry their own NOT NULL. */
type ImpliesNotNull<TypeTokens extends string[], F extends FamilyName> = F extends 'sqlite'
  ? false
  : TypeTokens extends [infer Name extends string, ...string[]]
    ? Lowercase<Name> extends
        | 'serial'
        | 'bigserial'
        | 'smallserial'
        | 'serial2'
        | 'serial4'
        | 'serial8'
      ? true
      : false
    : false

// --- column types ---------------------------------------------------------------------------

/** The type words with every parenthesised argument list removed. */
type TypeWords<
  T extends string[],
  Acc extends string[] = [],
  Depth extends unknown[] = [],
> = T extends [infer Head extends string, ...infer Rest extends string[]]
  ? Head extends '('
    ? TypeWords<Rest, Acc, [...Depth, 0]>
    : Head extends ')'
      ? TypeWords<Rest, Acc, Depth extends [unknown, ...infer D] ? D : []>
      : Depth extends []
        ? TypeWords<Rest, [...Acc, Head], Depth>
        : TypeWords<Rest, Acc, Depth>
  : Acc

type JoinWords<T extends string[], Acc extends string = ''> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? JoinWords<Rest, Acc extends '' ? Head : `${Acc} ${Head}`>
  : Acc

/** The text SQLite stores as a column's declared type: words spaced, punctuation glued. */
type DeclaredType<T extends string[], Acc extends string = ''> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? DeclaredType<
      Rest,
      Head extends '(' | ')' | ','
        ? `${Acc}${Head}`
        : Acc extends '' | `${string}(` | `${string},`
          ? `${Acc}${Head}`
          : `${Acc} ${Head}`
    >
  : Acc

/** The values of `ENUM('a', 'b')` / `AS ENUM ('a', 'b')`, or `string` when one is not plain. */
type EnumValues<T extends string[]> = EnumGroup<T>

type EnumGroup<T extends string[]> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Head extends '('
    ? LiteralUnion<SplitComma<GroupEnd<Rest>['group']>>
    : EnumGroup<Rest>
  : string

type LiteralUnion<Groups extends string[][]> = {
  [K in keyof Groups]: Groups[K] extends [`'${infer Value}'`] ? Value : false
}[number] extends infer U
  ? false extends U
    ? string
    : U
  : string

type RawTypeOf<T extends string[], F extends FamilyName> = F extends 'sqlite'
  ? DeclaredType<T>
  : F extends 'mysql'
    ? MysqlRawType<T>
    : PostgresRawType<T>

type MysqlRawType<T extends string[]> =
  JoinWords<
    LowerAll<TypeWords<T>> extends infer Words extends string[]
      ? DropWords<Words, 'unsigned' | 'signed' | 'zerofill'>
      : []
  > extends infer Base extends string
    ? Base extends 'enum'
      ? { readonly ts: EnumValues<T> }
      : MysqlCanonical<Base>
    : never

type PostgresRawType<T extends string[]> =
  LowerUnquoted<TypeWords<T>> extends infer Words extends string[]
    ? HasArraySuffix<Words> extends true
      ? `${PostgresCanonical<JoinWords<StripArray<Words>>>}[]`
      : PostgresCanonical<JoinWords<Words>>
    : never

type LowerAll<T extends string[]> = { [K in keyof T]: Lowercase<T[K]> }

/** PostgreSQL folds an unquoted name to lower case and keeps a quoted one as written. */
type LowerUnquoted<T extends string[]> = {
  [K in keyof T]: T[K] extends `"${infer Inner}"` ? Inner : Lowercase<T[K]>
}

type DropWords<T extends string[], Words extends string> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Head extends Words
    ? DropWords<Rest, Words>
    : [Head, ...DropWords<Rest, Words>]
  : []

type HasArraySuffix<Words extends string[]> = Words extends [...string[], infer Last extends string]
  ? Last extends `${string}[]` | 'array' | `[${string}]` | `${string}[${string}]`
    ? true
    : false
  : false

/** Removes `[]`, `[3]` and `ARRAY` from the end of a PostgreSQL type. */
type StripArray<Words extends string[]> = Words extends [
  ...infer Init extends string[],
  infer Last extends string,
]
  ? Last extends 'array' | `[${string}]`
    ? StripArray<Init>
    : Last extends `${infer Base}[${string}`
      ? [...Init, Base]
      : Words
  : Words

type PostgresAliases = {
  integer: 'int4'
  int: 'int4'
  serial: 'int4'
  serial4: 'int4'
  bigint: 'int8'
  bigserial: 'int8'
  serial8: 'int8'
  smallint: 'int2'
  smallserial: 'int2'
  serial2: 'int2'
  real: 'float4'
  float: 'float8'
  'double precision': 'float8'
  decimal: 'numeric'
  boolean: 'bool'
  'character varying': 'varchar'
  character: 'bpchar'
  char: 'bpchar'
  'timestamp without time zone': 'timestamp'
  'timestamp with time zone': 'timestamptz'
  'time without time zone': 'time'
  'time with time zone': 'timetz'
  'bit varying': 'varbit'
}

/** A PostgreSQL type as `pg_type.typname` names it, the key `inferql schema` maps from. */
type PostgresCanonical<Name extends string> =
  LastSegment<Unquote<Name>> extends infer Bare extends string
    ? Bare extends keyof PostgresAliases
      ? PostgresAliases[Bare]
      : Bare
    : never

type MysqlAliases = {
  integer: 'int'
  bool: 'tinyint'
  boolean: 'tinyint'
  serial: 'bigint'
  real: 'double'
  'double precision': 'double'
  dec: 'decimal'
  numeric: 'decimal'
  fixed: 'decimal'
  character: 'char'
  nchar: 'char'
  'national char': 'char'
  'national character': 'char'
  'character varying': 'varchar'
  nvarchar: 'varchar'
  'national varchar': 'varchar'
  'national character varying': 'varchar'
}

/** A MySQL type as `information_schema.columns.DATA_TYPE` names it. */
type MysqlCanonical<Name extends string> = Name extends keyof MysqlAliases
  ? MysqlAliases[Name]
  : Name

// --- type → TypeScript ----------------------------------------------------------------------

/** What `postgres.js` returns for each type, as the PostgreSQL dialect's `toTsType` says. */
type PostgresTypes = {
  int2: number
  int4: number
  float4: number
  float8: number
  oid: number
  int8: string
  numeric: string
  money: string
  text: string
  varchar: string
  bpchar: string
  char: string
  name: string
  citext: string
  uuid: string
  time: string
  timetz: string
  interval: string
  inet: string
  cidr: string
  macaddr: string
  xml: string
  tsvector: string
  tsquery: string
  point: string
  line: string
  lseg: string
  box: string
  path: string
  polygon: string
  circle: string
  bit: string
  varbit: string
  bool: boolean
  date: Date
  timestamp: Date
  timestamptz: Date
  bytea: Buffer
  json: unknown
  jsonb: unknown
}

/** What `mysql2` returns for each type, as the MySQL dialect's `toTsType` says. */
type MysqlTypes = {
  tinyint: number
  smallint: number
  mediumint: number
  int: number
  year: number
  float: number
  double: number
  bigint: number
  decimal: string
  varchar: string
  char: string
  text: string
  tinytext: string
  mediumtext: string
  longtext: string
  enum: string
  set: string
  time: string
  date: Date
  datetime: Date
  timestamp: Date
  bit: Buffer
  binary: Buffer
  varbinary: Buffer
  blob: Buffer
  tinyblob: Buffer
  mediumblob: Buffer
  longblob: Buffer
  geometry: Buffer
  json: unknown
}

/** SQLite's type affinity rules, read from the declared type like the SQLite dialect does. */
type SqliteType<Declared extends string> =
  Uppercase<Declared> extends `${string}INT${string}`
    ? number
    : Uppercase<Declared> extends `${string}${'CHAR' | 'CLOB' | 'TEXT'}${string}`
      ? string
      : Uppercase<Declared> extends `${string}BLOB${string}` | ''
        ? Uint8Array
        : Uppercase<Declared> extends `${string}${'REAL' | 'FLOA' | 'DOUB'}${string}`
          ? number
          : Uppercase<Declared> extends `${string}${'DATE' | 'TIME' | 'JSON'}${string}`
            ? string
            : number

/** An override whose key matches the type name, ignoring case; `never` when there is none. */
type OverrideFor<O, Name extends string> = {
  [K in keyof O & string]: Lowercase<K> extends Lowercase<Name> ? [O[K]] : never
}[keyof O & string]

type TsType<
  Raw extends RawType,
  Types extends State['types'],
  F extends FamilyName,
  O,
> = Raw extends { readonly ts: infer Ts }
  ? Ts
  : Raw extends string
    ? [OverrideFor<O, Raw>] extends [never]
      ? F extends 'postgres'
        ? Raw extends `${infer Element}[]`
          ? TsType<Element, Types, F, O>[]
          : NamedType<Raw, Types, F, O>
        : F extends 'mysql'
          ? Raw extends keyof MysqlTypes
            ? MysqlTypes[Raw]
            : unknown
          : SqliteType<Raw>
      : OverrideFor<O, Raw> extends [infer Override]
        ? Override
        : never
    : unknown

type NamedType<
  Raw extends string,
  Types extends State['types'],
  F extends FamilyName,
  O,
> = Raw extends keyof Types
  ? Types[Raw] extends { readonly ts: infer Ts }
    ? Ts
    : Types[Raw] extends { readonly domain: infer Base extends RawType }
      ? TsType<Base, Types, F, O>
      : unknown
  : Raw extends keyof PostgresTypes
    ? PostgresTypes[Raw]
    : unknown

/** A table whose shape is not known: any column, of an unknown type. */
type OpaqueTable = { readonly [column: string]: Column<unknown, true> }

type ResolveSchema<St extends State, F extends FamilyName, O> = {
  -readonly [T in keyof St['tables']]: T extends St['opaque']
    ? OpaqueTable
    : {
        -readonly [C in keyof St['tables'][T]]: Column<
          TsType<St['tables'][T][C]['type'], St['types'], F, O>,
          St['tables'][T][C]['nullable']
        >
      }
}

// --- CREATE TYPE / DOMAIN / VIEW ------------------------------------------------------------

type CreateType<T extends string[], St extends State, F extends FamilyName> = T extends [
  infer RawName extends string,
  infer As extends string,
  ...infer Rest extends string[],
]
  ? Upper<As> extends 'AS'
    ? Rest extends [infer Enum extends string, ...string[]]
      ? Upper<Enum> extends 'ENUM'
        ? WithType<St, Ident<RawName, F>, { readonly ts: EnumValues<Rest> }>
        : WithType<St, Ident<RawName, F>, { readonly ts: unknown }>
      : WithType<St, Ident<RawName, F>, { readonly ts: unknown }>
    : WithType<St, Ident<RawName, F>, { readonly ts: unknown }>
  : St

type CreateDomain<T extends string[], St extends State, F extends FamilyName> = T extends [
  infer RawName extends string,
  ...infer Rest extends string[],
]
  ? (
      Rest extends [infer As extends string, ...infer AfterAs extends string[]]
        ? Upper<As> extends 'AS'
          ? AfterAs
          : Rest
        : Rest
    ) extends infer Def extends string[]
    ? ColumnDefinition<['domain', ...Def], F> extends {
        readonly column: { readonly type: infer Base extends RawType }
      }
      ? WithType<St, Ident<RawName, F>, { readonly domain: Base }>
      : WithType<St, Ident<RawName, F>, { readonly ts: unknown }>
    : St
  : St

/** Words that may stand between `CREATE` and `VIEW`. */
type ViewPrefixWord =
  | 'OR'
  | 'REPLACE'
  | 'TEMP'
  | 'TEMPORARY'
  | 'MATERIALIZED'
  | 'RECURSIVE'
  | 'ALGORITHM'
  | 'DEFINER'
  | 'SQL'
  | 'SECURITY'
  | 'INVOKER'
  | 'UNDEFINED'
  | 'MERGE'
  | 'TEMPTABLE'

/** Skips the prefix of a view (`OR REPLACE`, `ALGORITHM = MERGE`, ...) up to `VIEW`. */
type SkipViewPrefix<T extends string[]> = T extends [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Upper<Head> extends 'VIEW'
    ? { readonly rest: Rest }
    : Upper<Head> extends ViewPrefixWord
      ? SkipViewPrefix<Rest>
      : Head extends '='
        ? Rest extends [string, ...infer After extends string[]]
          ? SkipViewPrefix<After>
          : false
        : false
  : false

/**
 * `CREATE VIEW name AS SELECT ...` — the view's columns are the row the select yields against
 * the tables created so far. A column list, options or a select the parser cannot type make
 * the view opaque.
 */
type CreateView<T extends string[], St extends State, F extends FamilyName, O> =
  SkipViewPrefix<T> extends { readonly rest: infer Rest extends string[] }
    ? SkipIfNotExists<Rest> extends {
        readonly found: infer IfNotExists extends boolean
        readonly rest: [infer RawName extends string, ...infer AfterName extends string[]]
      }
      ? Ident<RawName, F> extends infer Name extends string
        ? IfNotExists extends true
          ? HasTable<St, Name> extends true
            ? St
            : ViewBody<Name, AfterName, St, F, O>
          : ViewBody<Name, AfterName, St, F, O>
        : St
      : St
    : St

type ViewBody<
  Name extends string,
  T extends string[],
  St extends State,
  F extends FamilyName,
  O,
> = T extends [infer As extends string, ...infer Select extends string[]]
  ? Upper<As> extends 'AS'
    ? ParseTokens<Select, ResolveSchema<St, F, O>>['row'] extends infer Row
      ? string extends keyof Row
        ? WithOpaque<St, Name>
        : WithTable<
            St,
            Name,
            {
              [K in keyof Row & string]: {
                type: { readonly ts: Exclude<Row[K], null> }
                nullable: null extends Row[K] ? true : false
              }
            }
          >
      : never
    : WithOpaque<St, Name>
  : WithOpaque<St, Name>

// --- DROP -----------------------------------------------------------------------------------

type ApplyDrop<T extends string[], St extends State, F extends FamilyName> =
  SkipWords<T, 'TEMPORARY' | 'MATERIALIZED'> extends [
    infer Kind extends string,
    ...infer Rest extends string[],
  ]
    ? Upper<Kind> extends 'TABLE' | 'VIEW'
      ? WithoutTables<St, DropNames<Rest, F>>
      : Upper<Kind> extends 'TYPE' | 'DOMAIN'
        ? WithoutTypes<St, DropNames<Rest, F>>
        : St
    : St

/** `[IF EXISTS] a, b [CASCADE | RESTRICT]` → the names. */
type DropNames<T extends string[], F extends FamilyName> = IdentList<
  SplitComma<TakeUntil<SkipIfExists<T>['rest'], 'CASCADE' | 'RESTRICT'>['taken']>,
  F
>

// --- RENAME TABLE (MySQL) -------------------------------------------------------------------

type ApplyRenameTables<T extends string[], St extends State, F extends FamilyName> = T extends [
  infer Table extends string,
  ...infer Rest extends string[],
]
  ? Upper<Table> extends 'TABLE'
    ? RenamePairs<SplitComma<Rest>, St, F>
    : St
  : St

type RenamePairs<Pairs extends string[][], St extends State, F extends FamilyName> = Pairs extends [
  infer Pair extends string[],
  ...infer Rest extends string[][],
]
  ? Pair extends [infer From extends string, infer To extends string, infer Target extends string]
    ? Upper<To> extends 'TO'
      ? RenameTable<St, Ident<From, F>, Ident<Target, F>> extends infer Next extends State
        ? RenamePairs<Rest, Next, F>
        : St
      : St
    : St
  : St

type RenameTable<St extends State, From extends string, To extends string> =
  HasTable<St, From> extends true
    ? From extends St['opaque']
      ? WithOpaque<WithoutTables<St, From>, To>
      : WithTable<WithoutTables<St, From>, To, St['tables'][From]>
    : St

// --- ALTER ----------------------------------------------------------------------------------

type ApplyAlter<T extends string[], St extends State, F extends FamilyName> = T extends [
  infer Kind extends string,
  ...infer Rest extends string[],
]
  ? Upper<Kind> extends 'TABLE'
    ? AlterTable<Rest, St, F>
    : Upper<Kind> extends 'TYPE'
      ? AlterType<Rest, St, F>
      : St
  : St

type AlterTable<T extends string[], St extends State, F extends FamilyName> =
  SkipWords<SkipIfExists<T>['rest'], 'ONLY'> extends [
    infer RawName extends string,
    ...infer Rest extends string[],
  ]
    ? Ident<RawName, F> extends infer Name extends string
      ? HasTable<St, Name> extends true
        ? Name extends St['opaque']
          ? St
          : AlterActions<SplitComma<Rest>, Name, St, F>
        : St
      : St
    : St

type AlterActions<
  Actions extends string[][],
  Name extends string,
  St extends State,
  F extends FamilyName,
> = Actions extends [infer Action extends string[], ...infer Rest extends string[][]]
  ? AlterAction<Action, Name, St, F> extends infer Next extends State
    ? Next extends { readonly renamed: infer NewName extends string }
      ? AlterActions<
          Rest,
          NewName,
          { tables: Next['tables']; opaque: Next['opaque']; types: Next['types'] },
          F
        >
      : AlterActions<Rest, Name, Next, F>
    : St
  : St

type ColumnsOf<St extends State, Name extends string> = St['tables'][Name]

type WithColumns<St extends State, Name extends string, Cols> = WithTable<St, Name, Cols>

/** Table options that change no column (MySQL `ENGINE = ...`, PostgreSQL `OWNER TO`, ...). */
type HarmlessAlterWord =
  | 'ENGINE'
  | 'AUTO_INCREMENT'
  | 'CONVERT'
  | 'DEFAULT'
  | 'CHARACTER'
  | 'CHARSET'
  | 'COLLATE'
  | 'COMMENT'
  | 'ROW_FORMAT'
  | 'ALGORITHM'
  | 'LOCK'
  | 'OWNER'
  | 'ENABLE'
  | 'DISABLE'
  | 'FORCE'
  | 'NO'
  | 'CLUSTER'
  | 'VALIDATE'
  | 'REPLICA'
  | 'INHERIT'
  | 'ATTACH'
  | 'DETACH'
  | 'RESET'
  | 'SET'

/** The constraint kinds `ADD` / `DROP` can name instead of a column. */
type ConstraintKind =
  | 'CONSTRAINT'
  | 'PRIMARY'
  | 'UNIQUE'
  | 'FOREIGN'
  | 'CHECK'
  | 'INDEX'
  | 'KEY'
  | 'FULLTEXT'
  | 'SPATIAL'
  | 'EXCLUDE'

type AlterAction<
  Action extends string[],
  Name extends string,
  St extends State,
  F extends FamilyName,
> = Action extends [infer Verb extends string, ...infer Rest extends string[]]
  ? Upper<Verb> extends 'ADD'
    ? AlterAdd<Rest, Name, St, F>
    : Upper<Verb> extends 'DROP'
      ? AlterDrop<Rest, Name, St, F>
      : Upper<Verb> extends 'RENAME'
        ? AlterRename<Rest, Name, St, F>
        : Upper<Verb> extends 'ALTER'
          ? AlterColumn<SkipWords<Rest, 'COLUMN'>, Name, St, F>
          : Upper<Verb> extends 'MODIFY'
            ? ReplaceColumn<SkipWords<Rest, 'COLUMN'>, Name, St, F>
            : Upper<Verb> extends 'CHANGE'
              ? SkipWords<Rest, 'COLUMN'> extends [
                  infer Old extends string,
                  ...infer Def extends string[],
                ]
                ? ReplaceColumn<
                    Def,
                    Name,
                    WithColumns<St, Name, DropKey<ColumnsOf<St, Name>, Ident<Old, F>>>,
                    F
                  >
                : WithOpaque<St, Name>
              : Upper<Verb> extends HarmlessAlterWord
                ? St
                : WithOpaque<St, Name>
  : St

type AlterAdd<
  T extends string[],
  Name extends string,
  St extends State,
  F extends FamilyName,
> = T extends [infer First extends string, ...string[]]
  ? Upper<First> extends ConstraintKind
    ? PrimaryKeyOf<T, F> extends infer Keys extends string
      ? [Keys] extends [never]
        ? St
        : WithColumns<St, Name, MarkNotNull<ColumnsOf<St, Name>, Keys>>
      : St
    : SkipIfNotExists<SkipWords<T, 'COLUMN'>> extends {
          readonly found: infer IfNotExists extends boolean
          readonly rest: infer Def extends string[]
        }
      ? ColumnDefinition<TakeUntil<Def, 'FIRST' | 'AFTER'>['taken'], F> extends {
          readonly name: infer ColumnName extends string
          readonly column: infer C
        }
        ? IfNotExists extends true
          ? ColumnName extends keyof ColumnsOf<St, Name>
            ? St
            : WithColumns<St, Name, SetKey<ColumnsOf<St, Name>, ColumnName, C>>
          : WithColumns<St, Name, SetKey<ColumnsOf<St, Name>, ColumnName, C>>
        : WithOpaque<St, Name>
      : WithOpaque<St, Name>
  : WithOpaque<St, Name>

type AlterDrop<
  T extends string[],
  Name extends string,
  St extends State,
  F extends FamilyName,
> = T extends [infer First extends string, ...string[]]
  ? Upper<First> extends ConstraintKind | 'DEFAULT'
    ? St
    : SkipIfExists<SkipWords<T, 'COLUMN'>>['rest'] extends [
          infer ColumnName extends string,
          ...string[],
        ]
      ? WithColumns<St, Name, DropKey<ColumnsOf<St, Name>, Ident<ColumnName, F>>>
      : WithOpaque<St, Name>
  : WithOpaque<St, Name>

type AlterRename<
  T extends string[],
  Name extends string,
  St extends State,
  F extends FamilyName,
> = T extends [infer First extends string, ...infer Rest extends string[]]
  ? Upper<First> extends 'TO' | 'AS'
    ? Rest extends [infer NewName extends string]
      ? RenameTable<St, Name, Ident<NewName, F>> & { readonly renamed: Ident<NewName, F> }
      : WithOpaque<St, Name>
    : Upper<First> extends 'INDEX' | 'KEY' | 'CONSTRAINT'
      ? St
      : SkipWords<T, 'COLUMN'> extends [
            infer From extends string,
            infer To extends string,
            infer Target extends string,
          ]
        ? Upper<To> extends 'TO'
          ? Ident<From, F> extends infer Old extends keyof ColumnsOf<St, Name> & string
            ? WithColumns<
                St,
                Name,
                SetKey<
                  DropKey<ColumnsOf<St, Name>, Old>,
                  Ident<Target, F>,
                  ColumnsOf<St, Name>[Old]
                >
              >
            : WithOpaque<St, Name>
          : WithOpaque<St, Name>
        : WithOpaque<St, Name>
  : WithOpaque<St, Name>

/** MySQL `MODIFY` / `CHANGE`: the new definition replaces the column entirely. */
type ReplaceColumn<
  Def extends string[],
  Name extends string,
  St extends State,
  F extends FamilyName,
> =
  ColumnDefinition<TakeUntil<Def, 'FIRST' | 'AFTER'>['taken'], F> extends {
    readonly name: infer ColumnName extends string
    readonly column: infer C
  }
    ? WithColumns<St, Name, SetKey<ColumnsOf<St, Name>, ColumnName, C>>
    : WithOpaque<St, Name>

/** `ALTER [COLUMN] c SET NOT NULL | DROP NOT NULL | [SET DATA] TYPE t | SET DEFAULT ...`. */
type AlterColumn<
  T extends string[],
  Name extends string,
  St extends State,
  F extends FamilyName,
> = T extends [infer RawColumn extends string, ...infer Rest extends string[]]
  ? Upper<RawColumn> extends 'CONSTRAINT'
    ? St
    : Ident<RawColumn, F> extends infer ColumnName extends keyof ColumnsOf<St, Name> & string
      ? ColumnsOf<St, Name>[ColumnName] extends infer Current extends ColumnState
        ? Rest extends [
            infer A extends string,
            infer B extends string,
            ...infer After extends string[],
          ]
          ? [Upper<A>, Upper<B>] extends ['SET', 'NOT']
            ? WithColumns<
                St,
                Name,
                SetKey<ColumnsOf<St, Name>, ColumnName, { type: Current['type']; nullable: false }>
              >
            : [Upper<A>, Upper<B>] extends ['DROP', 'NOT']
              ? WithColumns<
                  St,
                  Name,
                  SetKey<ColumnsOf<St, Name>, ColumnName, { type: Current['type']; nullable: true }>
                >
              : [Upper<A>, Upper<B>] extends ['SET', 'DATA']
                ? AlterColumnType<SkipWords<After, 'TYPE'>, Name, ColumnName, Current, St, F>
                : Upper<A> extends 'TYPE'
                  ? AlterColumnType<[B, ...After], Name, ColumnName, Current, St, F>
                  : Upper<A> extends 'SET' | 'DROP'
                    ? Upper<B> extends
                        | 'DEFAULT'
                        | 'STATISTICS'
                        | 'STORAGE'
                        | 'COMPRESSION'
                        | 'VISIBLE'
                        | 'INVISIBLE'
                        | 'IDENTITY'
                      ? St
                      : WithOpaque<St, Name>
                    : WithOpaque<St, Name>
          : WithOpaque<St, Name>
        : WithOpaque<St, Name>
      : WithOpaque<St, Name>
  : WithOpaque<St, Name>

type AlterColumnType<
  T extends string[],
  Name extends string,
  ColumnName extends string,
  Current extends ColumnState,
  St extends State,
  F extends FamilyName,
> = WithColumns<
  St,
  Name,
  SetKey<
    ColumnsOf<St, Name>,
    ColumnName,
    {
      type: RawTypeOf<TakeUntil<T, 'USING' | 'COLLATE'>['taken'], F>
      nullable: Current['nullable']
    }
  >
>

/** `ALTER TYPE t ADD VALUE 'x'`; any other change leaves the type unknown. */
type AlterType<T extends string[], St extends State, F extends FamilyName> = T extends [
  infer RawName extends string,
  ...infer Rest extends string[],
]
  ? Ident<RawName, F> extends infer Name extends string
    ? Rest extends [
        infer Add extends string,
        infer Value extends string,
        ...infer After extends string[],
      ]
      ? [Upper<Add>, Upper<Value>] extends ['ADD', 'VALUE']
        ? SkipIfNotExists<After>['rest'] extends [`'${infer Literal}'`, ...string[]]
          ? Name extends keyof St['types']
            ? St['types'][Name] extends { readonly ts: infer Values }
              ? WithType<St, Name, { readonly ts: Values | Literal }>
              : St
            : St
          : WithType<St, Name, { readonly ts: unknown }>
        : Upper<Add> extends 'OWNER'
          ? St
          : WithType<St, Name, { readonly ts: unknown }>
      : WithType<St, Name, { readonly ts: unknown }>
    : St
  : St
