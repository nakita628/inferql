import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Config, ConnectionConfig, Target } from '../core/index.js'
import {
  connectionsOf,
  matchesPattern,
  normalizeTarget,
  printTarget,
  resolveAnnotation,
} from '../core/index.js'
import type { CheckRequest, CheckResponse } from '../protocol.js'
import { checkSync } from '../sync.js'
import type { Call, Node } from './ast.js'
import { collectTypeAliases, isCall, isNode, queryArgumentOf, typeArgumentOf } from './ast.js'
import { optionsSchema } from './schema.js'

// `sql('...')` infers its row type from the schema; `sql.as<Row>('...')` names it, and the
// database decides what it is.
const DEFAULT_TARGETS: readonly Target[] = [{ call: 'sql' }, { call: 'sql.as', annotate: true }]

const messages = {
  invalidQuery: 'Invalid query: {{error}}',
  setupFailed: 'inferql could not check this query ({{stage}}): {{error}}',
  duplicateColumns: 'Query returns duplicate columns ({{columns}}); TypeScript cannot type them',
  missingTypeAnnotations: 'Query is missing its type annotation\n\tFix with: {{fix}}',
  incorrectTypeAnnotations:
    'Query has an incorrect type annotation.\n\tExpected: {{expected}}\n\t  Actual: {{actual}}',
  invalidTypeAnnotations: 'Query has a type annotation inferql cannot read: {{reason}}',
  applyFix: 'Write the inferred type',
} as const

type Fix = { readonly range: [number, number]; readonly text: string }

type Fixer = {
  readonly insertTextAfter: (node: Node, text: string) => Fix
  readonly replaceText: (node: Node, text: string) => Fix
}

type LineColumn = { readonly line: number; readonly column: number }

type DiagnosticBase = {
  readonly messageId: keyof typeof messages
  readonly data?: Readonly<Record<string, string>>
  readonly fix?: (fixer: Fixer) => Fix
  // Mutable arrays: oxlint's `Diagnostic` declares them so.
  readonly suggest?: {
    readonly messageId: keyof typeof messages
    readonly fix: (fixer: Fixer) => Fix
  }[]
}

/** oxlint wants a `node` or a `loc` on every report, never neither. */
type Diagnostic =
  | (DiagnosticBase & { readonly node: Node })
  | (DiagnosticBase & { readonly loc: { readonly start: LineColumn; readonly end: LineColumn } })

type RuleContext = {
  readonly filename: string
  readonly cwd?: string
  readonly options: readonly unknown[]
  readonly sourceCode: {
    readonly text: string
    readonly getText: (node: Node) => string
    readonly getLocFromIndex: (index: number) => LineColumn
  }
  readonly report: (diagnostic: Diagnostic) => void
}

// Visitors take `unknown`: oxlint's AST interfaces and this file's structural `Node` only meet
// through a guard.
type Visitor = Readonly<Record<string, (node: unknown) => void>>

type Match = {
  readonly call: Call
  readonly text: string
  /** The literal holding the text (delimiters included), for mapping error positions. */
  readonly literal: Node
  readonly target: Target
}

function isConfig(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && 'connections' in value
}

/**
 * The directory of the nearest `package.json` above the linted file: relative
 * `databaseUrl` / `migrationsDir` values resolve against it, as they would for a CLI.
 */
export function locateProjectDir(filename: string, fallback: string): string {
  let current = path.dirname(filename)
  for (;;) {
    if (existsSync(path.join(current, 'package.json'))) return current
    const parent = path.dirname(current)
    if (parent === current) return fallback
    current = parent
  }
}

/** The targets of one connection that claim this call. */
function matchesOf(call: Call, connection: ConnectionConfig, context: RuleContext): Match[] {
  const targets = connection.targets ?? DEFAULT_TARGETS
  const callee = context.sourceCode.getText(call.callee)
  const argument = queryArgumentOf(call)
  if (argument === undefined) return []
  return targets
    .filter((target) => matchesPattern(target.call, callee))
    .map((target) => ({ call, text: argument.text, literal: argument.node, target }))
}

/** Points a database error offset back into the string literal. */
function locate(match: Match, position: number, context: RuleContext) {
  // The literal's range covers its quotes: step inside.
  const start = match.literal.range[0] + 1 + position
  const end = Math.min(start + 1, match.literal.range[1] - 1)
  return {
    loc: {
      start: context.sourceCode.getLocFromIndex(start),
      end: context.sourceCode.getLocFromIndex(Math.max(end, start)),
    },
  }
}

function reportFailure(
  match: Match,
  response: CheckResponse & { ok: false },
  context: RuleContext,
) {
  if (response.kind === 'query') {
    const where =
      response.position === undefined
        ? { node: match.literal }
        : locate(match, response.position, context)
    context.report({ ...where, messageId: 'invalidQuery', data: { error: response.message } })
    return
  }
  context.report({
    node: match.call.callee,
    messageId: 'setupFailed',
    data: { stage: response.kind, error: response.message },
  })
}

function annotationOf(
  match: Match,
  aliases: ReadonlyMap<string, Node>,
):
  | { readonly node: Node; readonly text: string }
  | { readonly node: Node; readonly reason: string }
  | undefined {
  const node = typeArgumentOf(match.call)
  if (node === undefined) return undefined
  const resolved = resolveAnnotation(node, { resolveReference: (name) => aliases.get(name) })
  return resolved.ok
    ? { node, text: printTarget(normalizeTarget(resolved.target)) }
    : { node, reason: resolved.reason }
}

function reportSuccess(
  match: Match,
  response: CheckResponse & { ok: true },
  connection: ConnectionConfig,
  aliases: ReadonlyMap<string, Node>,
  context: RuleContext,
) {
  if (response.duplicateColumns.length > 0) {
    context.report({
      node: match.literal,
      messageId: 'duplicateColumns',
      data: { columns: response.duplicateColumns.join(', ') },
    })
    return
  }
  const expected = printTarget(normalizeTarget(response.target))
  const annotation = annotationOf(match, aliases)
  const asSuggestion = connection.enforceType === 'suggest'

  if (annotation === undefined) {
    if (match.target.annotate !== true) return
    const fix = (fixer: Fixer) => fixer.insertTextAfter(match.call.callee, `<${expected}>`)
    context.report({
      node: match.call.callee,
      messageId: 'missingTypeAnnotations',
      data: { fix: expected },
      ...(asSuggestion ? { suggest: [{ messageId: 'applyFix', fix }] } : { fix }),
    })
    return
  }
  if ('reason' in annotation) {
    context.report({
      node: annotation.node,
      messageId: 'invalidTypeAnnotations',
      data: { reason: annotation.reason },
    })
    return
  }
  if (annotation.text === expected) return
  const fix = (fixer: Fixer) => fixer.replaceText(annotation.node, expected)
  context.report({
    node: annotation.node,
    messageId: 'incorrectTypeAnnotations',
    data: { expected, actual: annotation.text },
    ...(asSuggestion ? { suggest: [{ messageId: 'applyFix', fix }] } : { fix }),
  })
}

function checkMatch(
  match: Match,
  connection: ConnectionConfig,
  projectDir: string,
  aliases: ReadonlyMap<string, Node>,
  context: RuleContext,
) {
  const request: CheckRequest = { connection, projectDir, text: match.text }
  const response = checkSync(request)
  if (response.ok) {
    reportSuccess(match, response, connection, aliases, context)
  } else {
    reportFailure(match, response, context)
  }
}

function create(context: RuleContext): Visitor {
  const [options] = context.options
  if (!isConfig(options)) return {}
  const connections = connectionsOf(options)
  const projectDir = locateProjectDir(context.filename, context.cwd ?? process.cwd())
  let aliases: ReadonlyMap<string, Node> = new Map()
  return {
    Program(node) {
      if (isNode(node)) aliases = collectTypeAliases(node)
    },
    CallExpression(node) {
      if (!isCall(node)) return
      for (const connection of connections) {
        for (const match of matchesOf(node, connection, context)) {
          checkMatch(match, connection, projectDir, aliases, context)
        }
      }
    },
  }
}

/**
 * `inferql/check-sql`: every `sql('...')` is prepared against the configured database, so an
 * invalid query is an error even though its row type is inferred from the schema. For
 * `sql.as<Row>('...')` the row type the database reports must match `Row` (`--fix` writes it).
 */
export const checkSql = {
  meta: {
    type: 'problem',
    docs: {
      description: 'validate sql() queries against the database and keep sql.as<Row>() in sync',
      url: 'https://github.com/nakita628/inferql',
    },
    fixable: 'code',
    hasSuggestions: true,
    messages,
    schema: optionsSchema,
  },
  create,
} as const
