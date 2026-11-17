import type { SchemaColumn, SchemaInfo, SchemaTable } from 'inferql/introspect'

/**
 * SQL completion at the cursor, at run time: the same grammar as the type-level `Complete` in
 * inferql (`src/typed/complete.ts`), which an editor without this extension uses, but with the
 * cursor known — so it completes in the middle of a query as well as at its end — and with
 * the tables read from the database, so a column comes with its table and types.
 */

export type SqlCompletionKind = 'keyword' | 'table' | 'column' | 'function' | 'operator'

export type SqlCompletion = {
  readonly label: string
  readonly kind: SqlCompletionKind
  /** One line next to the label: a column's table and types, a table's column count. */
  readonly detail?: string
  /** Markdown shown beside the list: a table's columns, a column's details. */
  readonly documentation?: string
  /** Orders the list: columns before keywords where a column is due. */
  readonly sortText: string
}

export type SqlCompletions = {
  readonly items: readonly SqlCompletion[]
  /** How many characters before the cursor the chosen item replaces: the word being typed. */
  readonly replace: number
}

const NONE: SqlCompletions = { items: [], replace: 0 }

// --- tokens ---------------------------------------------------------------------------------

const TOKEN =
  /'(?:[^']|'')*'?|"[^"]*"?|`[^`]*`?|\[[^\]]*\]?|<=|>=|<>|!=|==|\|\||[(),;?=<>*]|[^\s(),;?=<>*']+/gu

function tokenize(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((match) => match[0])
}

function upper(token: string | undefined): string {
  return (token ?? '').toUpperCase()
}

function unquote(name: string): string {
  const first = name.at(0)
  const last = name.at(-1)
  if ((first === '"' && last === '"') || (first === '`' && last === '`')) return name.slice(1, -1)
  if (first === '[' && last === ']') return name.slice(1, -1)
  return name
}

const COMPARISON = new Set([
  '=',
  '<>',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  'LIKE',
  'ILIKE',
  'BETWEEN',
])
/** The tokens a name may follow with no space: `(a`, `a, b`, `id=1`. */
const GLUED_START = new Set(['(', ',', '=', '<>', '!=', '<', '>', '<=', '>='])

function isWord(token: string): boolean {
  return /^[^\s(),;?=<>*'\d$:@][^\s(),;?=<>*']*$/u.test(token) || /^["`[]/u.test(token)
}

function isValueEnd(token: string): boolean {
  return (
    /^'|^\d|^\?$|^\$\d+$|^[:@]\w/u.test(token) ||
    token === ')' ||
    ['NULL', 'TRUE', 'FALSE'].includes(upper(token))
  )
}

// --- the tables in scope --------------------------------------------------------------------

type TableRef = { readonly alias: string; readonly table: string }

const CLAUSE_END = new Set([
  'WHERE',
  'GROUP',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UNION',
  'RETURNING',
  'ON',
  'USING',
  'SET',
  'VALUES',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'CROSS',
  'FULL',
  'NATURAL',
])

/** `name`, `name alias` or `name AS alias`, starting at `index`. */
function tableRefAt(tokens: readonly string[], index: number): TableRef | undefined {
  const name = tokens[index]
  if (name === undefined || !isWord(name)) return undefined
  const table = unquote(name.split('.').at(-1) ?? name)
  const next = tokens[index + 1]
  if (upper(next) === 'AS') {
    const alias = tokens[index + 2]
    return { alias: alias === undefined ? table : unquote(alias), table }
  }
  if (next !== undefined && isWord(next) && !CLAUSE_END.has(upper(next))) {
    return { alias: unquote(next), table }
  }
  return { alias: table, table }
}

/** Every table the query names after FROM / JOIN / UPDATE / INTO, with its alias. */
function tablesOf(tokens: readonly string[]): TableRef[] {
  const refs: TableRef[] = []
  let inFrom = false
  for (const [index, token] of tokens.entries()) {
    const word = upper(token)
    if (['FROM', 'JOIN', 'UPDATE', 'INTO'].includes(word)) {
      const ref = tableRefAt(tokens, index + 1)
      if (ref !== undefined) refs.push(ref)
      inFrom = word === 'FROM'
    } else if (token === ',' && inFrom) {
      const ref = tableRefAt(tokens, index + 1)
      if (ref !== undefined) refs.push(ref)
    } else if (CLAUSE_END.has(word) || word === 'SELECT') {
      inFrom = false
    }
  }
  return refs
}

// --- where the cursor is --------------------------------------------------------------------

type Context =
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

const CLAUSE = new Set([
  'SELECT',
  'FROM',
  'JOIN',
  'WHERE',
  'GROUP',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'SET',
  'INTO',
  'UPDATE',
  'VALUES',
  'ON',
  'RETURNING',
])
const CONDITION_START = new Set(['WHERE', 'AND', 'OR', 'ON', 'HAVING', 'NOT', '('])

/** The last clause keyword in `tokens`. */
function clauseOf(tokens: readonly string[]): string {
  return upper(tokens.findLast((token) => CLAUSE.has(upper(token))))
}

function contextOf(prev: readonly string[], verb: string): Context {
  const last = prev.at(-1)
  if (last === undefined) return 'start'
  const init = prev.slice(0, -1)
  const word = upper(last)
  if (word === 'SELECT') return 'selectList'
  if (word === 'DISTINCT') return 'column'
  if (word === 'INSERT') return 'insert'
  if (word === 'DELETE') return 'delete'
  if (['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE'].includes(word)) return 'table'
  if (word === 'IS') return 'afterIs'
  if (word === 'IN') return 'none'
  if (word === 'NOT') return afterNot(init)
  if (CONDITION_START.has(word)) {
    if (last !== '(') return 'condition'
    const clause = clauseOf(init)
    if (clause === 'INTO') return 'column'
    return ['WHERE', 'ON', 'HAVING'].includes(clause) ? 'condition' : 'none'
  }
  if (COMPARISON.has(word) || word === 'BY' || word === 'SET') return 'column'
  if (word === 'RETURNING') return 'returning'
  if (last === ',') return afterComma(clauseOf(init))
  return afterWord(last, init, prev, verb)
}

function afterNot(init: readonly string[]): Context {
  const before = init.at(-1)
  if (before === undefined) return 'condition'
  if (upper(before) === 'IS') return 'afterIsNot'
  if (CONDITION_START.has(upper(before)) || CLAUSE.has(upper(before)) || !isWord(before)) {
    return 'condition'
  }
  return 'afterNot'
}

function afterComma(clause: string): Context {
  if (clause === 'FROM') return 'table'
  if (clause === 'SELECT') return 'selectList'
  return ['GROUP', 'ORDER', 'SET', 'RETURNING', 'INTO'].includes(clause) ? 'column' : 'none'
}

function afterWord(
  last: string,
  init: readonly string[],
  prev: readonly string[],
  verb: string,
): Context {
  const clause = clauseOf(prev)
  switch (clause) {
    case 'SELECT': {
      return last === '(' ? 'none' : 'afterSelectItem'
    }
    case 'FROM': {
      return verb === 'DELETE' ? 'afterDeleteTable' : 'afterTable'
    }
    case 'JOIN': {
      return 'afterJoinTable'
    }
    case 'WHERE':
    case 'ON':
    case 'HAVING': {
      if (isValueEnd(last)) return 'afterCondition'
      return COMPARISON.has(upper(init.at(-1))) ? 'afterCondition' : 'afterOperand'
    }
    case 'ORDER': {
      return 'afterOrderItem'
    }
    case 'GROUP': {
      return 'afterGroupItem'
    }
    case 'LIMIT':
    case 'OFFSET': {
      return 'afterLimit'
    }
    case 'INTO': {
      return last === ')' ? 'afterInsertColumns' : 'afterInsertTable'
    }
    case 'VALUES': {
      return last === ')' ? 'afterValues' : 'none'
    }
    case 'UPDATE': {
      return 'afterUpdateTable'
    }
    case 'SET': {
      return isValueEnd(last) ? 'afterSetItem' : 'none'
    }
    default: {
      return 'none'
    }
  }
}

// --- what to offer --------------------------------------------------------------------------

/** The functions the row type understands (inferql's `expr.ts`), with their parenthesis. */
const FUNCTIONS = [
  'COUNT(',
  'SUM(',
  'AVG(',
  'MIN(',
  'MAX(',
  'COALESCE(',
  'LOWER(',
  'UPPER(',
  'LENGTH(',
  'ROUND(',
  'CAST(',
]

const AFTER_TABLE = [
  'WHERE',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'CROSS JOIN',
  'GROUP BY',
  'ORDER BY',
  'LIMIT',
  'AS',
]

function keywordsAfter(context: Context, clause: string): string[] {
  switch (context) {
    case 'start': {
      return ['SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'WITH']
    }
    case 'afterSelectItem': {
      return ['FROM', 'AS']
    }
    case 'afterTable': {
      return AFTER_TABLE
    }
    case 'afterJoinTable': {
      return ['ON', 'USING', 'AS']
    }
    case 'afterCondition': {
      if (clause === 'ON') return ['AND', 'OR', 'WHERE', 'JOIN', 'LEFT JOIN', 'ORDER BY', 'LIMIT']
      if (clause === 'HAVING') return ['AND', 'OR', 'ORDER BY', 'LIMIT']
      return ['AND', 'OR', 'GROUP BY', 'ORDER BY', 'LIMIT', 'RETURNING']
    }
    case 'afterOrderItem': {
      return ['ASC', 'DESC', 'LIMIT']
    }
    case 'afterGroupItem': {
      return ['HAVING', 'ORDER BY', 'LIMIT']
    }
    case 'afterLimit': {
      return ['OFFSET']
    }
    case 'insert': {
      return ['INTO']
    }
    case 'afterInsertTable': {
      return ['VALUES', 'SELECT', 'DEFAULT VALUES']
    }
    case 'afterInsertColumns': {
      return ['VALUES', 'SELECT']
    }
    case 'afterValues': {
      return ['RETURNING']
    }
    case 'afterUpdateTable': {
      return ['SET']
    }
    case 'afterSetItem':
    case 'afterDeleteTable': {
      return ['WHERE', 'RETURNING']
    }
    case 'delete': {
      return ['FROM']
    }
    case 'afterIs': {
      return ['NULL', 'NOT NULL']
    }
    case 'afterIsNot': {
      return ['NULL']
    }
    case 'afterNot': {
      return ['LIKE', 'IN', 'BETWEEN']
    }
    case 'condition': {
      return ['NOT', 'EXISTS']
    }
    case 'selectList': {
      return ['DISTINCT']
    }
    case 'table':
    case 'column':
    case 'afterOperand':
    case 'returning':
    case 'none': {
      return []
    }
  }
  return []
}

const OPERATORS = ['=', '<>', 'IS NULL', 'IS NOT NULL', 'LIKE', 'IN', 'BETWEEN', 'NOT']

function columnType(column: SchemaColumn): string {
  return column.nullable && column.tsType !== 'unknown' ? `${column.tsType} | null` : column.tsType
}

function columnItem(table: SchemaTable, column: SchemaColumn, order: number): SqlCompletion {
  const type = columnType(column)
  return {
    label: column.name,
    kind: 'column',
    detail: `${table.name} · ${column.dataType} → ${type}`,
    documentation: [
      `**${table.name}.${column.name}**`,
      '',
      `| | |`,
      `| --- | --- |`,
      `| database type | \`${column.dataType}\` |`,
      `| TypeScript | \`${type}\` |`,
      `| nullable | ${column.nullable ? 'yes' : 'no'} |`,
    ].join('\n'),
    sortText: `${order}:${column.name}`,
  }
}

function tableItem(table: SchemaTable): SqlCompletion {
  return {
    label: table.name,
    kind: 'table',
    detail: `table · ${table.columns.length} columns`,
    documentation: [
      `**${table.name}**`,
      '',
      '| column | database type | TypeScript |',
      '| --- | --- | --- |',
      ...table.columns.map(
        (column) => `| ${column.name} | \`${column.dataType}\` | \`${columnType(column)}\` |`,
      ),
    ].join('\n'),
    sortText: `0:${table.name}`,
  }
}

function wordItem(
  label: string,
  kind: SqlCompletionKind,
  order: number,
  index: number,
): SqlCompletion {
  return { label, kind, sortText: `${order}:${String(index).padStart(3, '0')}` }
}

/** The columns of the named tables, or of every table when none is named yet. */
function columnItems(
  schema: SchemaInfo,
  tables: readonly string[],
  order: number,
): SqlCompletion[] {
  const named = new Set(tables)
  const inScope = schema.tables.filter((table) => named.size === 0 || named.has(table.name))
  return inScope.flatMap((table) => table.columns.map((column) => columnItem(table, column, order)))
}

function cased(words: readonly string[], isLower: boolean): string[] {
  return isLower ? words.map((word) => word.toLowerCase()) : [...words]
}

function itemsFor(
  context: Context,
  clause: string,
  schema: SchemaInfo,
  scope: readonly string[],
  isLower: boolean,
): SqlCompletion[] {
  const keywords = cased(keywordsAfter(context, clause), isLower).map((word, index) =>
    wordItem(word, 'keyword', 2, index),
  )
  if (context === 'table') return schema.tables.map((table) => tableItem(table))
  if (context === 'column') return columnItems(schema, scope, 0)
  if (context === 'selectList') {
    return [
      ...columnItems(schema, scope, 0),
      wordItem('*', 'operator', 1, 0),
      ...keywords,
      ...cased(FUNCTIONS, isLower).map((name, index) => wordItem(name, 'function', 3, index)),
    ]
  }
  if (context === 'condition') return [...columnItems(schema, scope, 0), ...keywords]
  if (context === 'returning') {
    return [...columnItems(schema, scope, 0), wordItem('*', 'operator', 1, 0)]
  }
  if (context === 'afterOperand') {
    return cased(OPERATORS, isLower).map((word, index) => wordItem(word, 'operator', 1, index))
  }
  return keywords
}

/**
 * The completions at the end of `before` (the literal up to the cursor). `text` is the whole
 * literal: the tables it names after the cursor count too, so `SELECT | FROM users` offers the
 * columns of `users`.
 */
export function completeSql(before: string, text: string, schema: SchemaInfo): SqlCompletions {
  const tokens = tokenize(before)
  const endsWithSpace = /\s$/u.test(before)
  const last = tokens.at(-1)
  let partial = ''
  let prev = tokens
  if (!endsWithSpace && last !== undefined) {
    if (isWord(last)) {
      partial = last
      prev = tokens.slice(0, -1)
    } else if (!GLUED_START.has(last)) {
      return NONE
    }
  }
  const all = tokenize(text)
  const refs = tablesOf(all)
  const known = new Set(schema.tables.map((table) => table.name))
  if (partial.includes('.')) {
    const alias = unquote(partial.slice(0, partial.lastIndexOf('.')))
    const typed = partial.slice(partial.lastIndexOf('.') + 1)
    const table = refs.find((ref) => ref.alias === alias)?.table ?? (known.has(alias) ? alias : '')
    if (table === '') return NONE
    return { items: narrow(columnItems(schema, [table], 0), typed), replace: typed.length }
  }
  const verb = upper(tokens[0])
  const context = contextOf(prev, verb)
  const isLower = (tokens[0] ?? 'S') === (tokens[0] ?? 'S').toLowerCase() && tokens.length > 0
  const scope = refs.map((ref) => ref.table).filter((table) => known.has(table))
  const items = itemsFor(context, clauseOf(prev), schema, scope, isLower)
  return { items: narrow(items, partial), replace: partial.length }
}

/** The items that start with what is typed, ignoring case. */
function narrow(items: readonly SqlCompletion[], typed: string): SqlCompletion[] {
  const lower = typed.toLowerCase()
  return items.filter((item) => item.label.toLowerCase().startsWith(lower))
}
