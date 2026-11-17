import { array, entry, literal, object, type, union } from './target.js'
import type { ResolvedTarget } from './target.js'

/**
 * The slice of the ESTree/TSESTree shape this module reads. Declared structurally so the
 * engine depends on no parser package: oxlint's JS plugin AST and typescript-estree both fit.
 */
export type TypeNode = {
  readonly type: string
  readonly [key: string]: unknown
}

export type AnnotationResult =
  | { readonly ok: true; readonly target: ResolvedTarget }
  | { readonly ok: false; readonly reason: string }

export type AnnotationContext = {
  /**
   * Resolves a bare type reference (`User`) to the node of its declaration. The rule
   * implements this by looking up `type User = ...` aliases in the same file; anything it
   * cannot see is reported as unresolvable rather than guessed.
   */
  readonly resolveReference: (name: string) => TypeNode | undefined
}

const KEYWORDS: Readonly<Record<string, string>> = {
  TSStringKeyword: 'string',
  TSNumberKeyword: 'number',
  TSBooleanKeyword: 'boolean',
  TSBigIntKeyword: 'bigint',
  TSNullKeyword: 'null',
  TSUndefinedKeyword: 'undefined',
  TSAnyKeyword: 'any',
  TSUnknownKeyword: 'unknown',
  TSNeverKeyword: 'never',
  TSObjectKeyword: 'object',
  TSSymbolKeyword: 'symbol',
  TSVoidKeyword: 'void',
}

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function isNode(value: unknown): value is TypeNode {
  return typeof property(value, 'type') === 'string'
}

function isNodeList(value: unknown): value is readonly TypeNode[] {
  return Array.isArray(value) && value.every(isNode)
}

function child(node: TypeNode, key: string): TypeNode | undefined {
  const value = node[key]
  return isNode(value) ? value : undefined
}

function children(node: TypeNode, key: string): readonly TypeNode[] {
  const value = node[key]
  return isNodeList(value) ? value : []
}

function fail(reason: string): AnnotationResult {
  return { ok: false, reason }
}

function ok(target: ResolvedTarget): AnnotationResult {
  return { ok: true, target }
}

function referenceName(node: TypeNode): string | undefined {
  const typeName = child(node, 'typeName')
  if (typeName?.type !== 'Identifier') return undefined
  const name = typeName.name
  return typeof name === 'string' ? name : undefined
}

function typeArguments(node: TypeNode): readonly TypeNode[] {
  const params = child(node, 'typeArguments') ?? child(node, 'typeParameters')
  return params === undefined ? [] : children(params, 'params')
}

function literalValue(node: TypeNode): ResolvedTarget | undefined {
  const inner = child(node, 'literal')
  if (inner === undefined) return undefined
  if (inner.type === 'Literal') {
    const value = inner.value
    if (typeof value === 'string') return literal(`'${value.replaceAll("'", String.raw`\'`)}'`)
    if (typeof value === 'number' || typeof value === 'bigint') return literal(String(value))
    if (typeof value === 'boolean') return type(String(value))
    if (value === null) return type('null')
    return undefined
  }
  if (inner.type === 'TemplateLiteral') {
    const quasis = children(inner, 'quasis')
    const [only] = quasis
    const cooked = only === undefined ? undefined : property(only.value, 'cooked')
    return quasis.length === 1 && typeof cooked === 'string' ? literal(`'${cooked}'`) : undefined
  }
  if (inner.type === 'UnaryExpression' && inner.operator === '-') {
    const argument = child(inner, 'argument')
    const value = argument?.type === 'Literal' ? argument.value : undefined
    return typeof value === 'number' ? literal(`-${value}`) : undefined
  }
  return undefined
}

function propertyKey(member: TypeNode): string | undefined {
  const key = child(member, 'key')
  if (key === undefined) return undefined
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name
  if (key.type === 'Literal') return String(key.value)
  return undefined
}

function resolveMembers(
  members: readonly TypeNode[],
  context: AnnotationContext,
  seen: ReadonlySet<string>,
): AnnotationResult {
  const entries = []
  for (const member of members) {
    if (member.type !== 'TSPropertySignature') {
      return fail(`unsupported member kind \`${member.type}\` in the type annotation`)
    }
    const key = propertyKey(member)
    const annotation = child(member, 'typeAnnotation')
    const valueNode = annotation === undefined ? undefined : child(annotation, 'typeAnnotation')
    if (key === undefined || valueNode === undefined) {
      return fail('a property in the type annotation has no readable key or type')
    }
    const value = resolve(valueNode, context, seen)
    if (!value.ok) return value
    entries.push(entry(key, value.target, member.optional === true))
  }
  return ok(object(entries))
}

function mergeObjects(targets: readonly ResolvedTarget[]): ResolvedTarget | undefined {
  const entries = []
  for (const target of targets) {
    if (target.kind !== 'object') return undefined
    for (const member of target.value) entries.push(member)
  }
  return object(entries)
}

function resolveAll(
  nodes: readonly TypeNode[],
  context: AnnotationContext,
  seen: ReadonlySet<string>,
): { readonly ok: true; readonly targets: readonly ResolvedTarget[] } | AnnotationResult {
  const targets = []
  for (const node of nodes) {
    const resolved = resolve(node, context, seen)
    if (!resolved.ok) return resolved
    targets.push(resolved.target)
  }
  return { ok: true, targets }
}

function resolve(
  node: TypeNode,
  context: AnnotationContext,
  seen: ReadonlySet<string>,
): AnnotationResult {
  const keyword = KEYWORDS[node.type]
  if (keyword !== undefined) return ok(type(keyword))
  switch (node.type) {
    case 'TSParenthesizedType': {
      const inner = child(node, 'typeAnnotation')
      return inner === undefined ? fail('empty parenthesised type') : resolve(inner, context, seen)
    }
    case 'TSLiteralType': {
      const value = literalValue(node)
      return value === undefined ? fail('unsupported literal type') : ok(value)
    }
    case 'TSUnionType': {
      const members = resolveAll(children(node, 'types'), context, seen)
      return members.ok && 'targets' in members ? ok(union(members.targets)) : members
    }
    case 'TSIntersectionType': {
      const members = resolveAll(children(node, 'types'), context, seen)
      if (!members.ok || !('targets' in members)) return members
      const merged = mergeObjects(members.targets)
      return merged === undefined
        ? fail('only intersections of object types are supported')
        : ok(merged)
    }
    case 'TSArrayType': {
      const element = child(node, 'elementType')
      if (element === undefined) return fail('array type without an element type')
      const resolved = resolve(element, context, seen)
      return resolved.ok ? ok(array(resolved.target)) : resolved
    }
    case 'TSTypeLiteral':
      return resolveMembers(children(node, 'members'), context, seen)
    case 'TSTypeReference':
      return resolveReference(node, context, seen)
    default:
      return fail(`unsupported type syntax \`${node.type}\` in the type annotation`)
  }
}

function resolveReference(
  node: TypeNode,
  context: AnnotationContext,
  seen: ReadonlySet<string>,
): AnnotationResult {
  const name = referenceName(node)
  if (name === undefined) return fail('qualified type names are not supported')
  const args = typeArguments(node)
  const [first] = args
  if ((name === 'Array' || name === 'ReadonlyArray') && first !== undefined) {
    const resolved = resolve(first, context, seen)
    return resolved.ok ? ok(array(resolved.target)) : resolved
  }
  if (name === 'Date' || name === 'Buffer' || name === 'Uint8Array') return ok(type(name))
  if (args.length > 0) return fail(`generic type \`${name}\` cannot be resolved without a checker`)
  if (seen.has(name)) return fail(`type \`${name}\` refers to itself`)
  const declaration = context.resolveReference(name)
  if (declaration === undefined) {
    return fail(
      `type \`${name}\` is not declared in this file; inferql resolves inline object types and same-file \`type\` aliases only`,
    )
  }
  return resolve(declaration, context, new Set([...seen, name]))
}

/**
 * Reads the type argument of `sql.as<...>('...')` into a target.
 */
export function resolveAnnotation(node: TypeNode, context: AnnotationContext): AnnotationResult {
  return resolve(node, context, new Set())
}
