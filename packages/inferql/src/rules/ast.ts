/**
 * The slice of oxlint's ESTree AST the rule reads, declared structurally: the plugin API
 * exports no node types yet, and a guard per shape keeps the rule honest about what it
 * assumes.
 */
export type Node = {
  readonly type: string
  // Mutable on purpose: oxlint's `Ranged` (what `getText` / fixers accept) is `[number, number]`.
  readonly range: [number, number]
  readonly parent?: Node | null | undefined
  readonly [key: string]: unknown
}

export type TypeArguments = Node & {
  readonly type: 'TSTypeParameterInstantiation'
  readonly params: readonly Node[]
}

export type Call = Node & {
  readonly type: 'CallExpression'
  readonly callee: Node
  readonly arguments: readonly Node[]
  readonly typeArguments?: TypeArguments | null | undefined
}

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

export function isNode(value: unknown): value is Node {
  const range = property(value, 'range')
  return typeof property(value, 'type') === 'string' && Array.isArray(range) && range.length === 2
}

function isNodeArray(value: unknown): value is readonly Node[] {
  return Array.isArray(value) && value.every(isNode)
}

export function isTypeArguments(value: unknown): value is TypeArguments {
  return isNode(value) && value.type === 'TSTypeParameterInstantiation' && isNodeArray(value.params)
}

export function isCall(value: unknown): value is Call {
  return (
    isNode(value) &&
    value.type === 'CallExpression' &&
    isNode(value.callee) &&
    isNodeArray(value.arguments)
  )
}

/**
 * The query text of a call's first argument when it is a plain string: a string literal or
 * a template literal without substitutions. `node` is where the text sits (delimiters
 * included), so an error position can be pointed back into it.
 */
export function queryArgumentOf(
  call: Call,
): { readonly text: string; readonly node: Node } | undefined {
  const [first] = call.arguments
  if (first === undefined) return undefined
  if (first.type === 'Literal' && typeof first.value === 'string') {
    return { text: first.value, node: first }
  }
  if (first.type === 'TemplateLiteral') {
    const quasis = first.quasis
    const expressions = first.expressions
    if (!isNodeArray(quasis) || !Array.isArray(expressions) || expressions.length > 0) {
      return undefined
    }
    const [only] = quasis
    if (only === undefined || quasis.length !== 1) return undefined
    const raw = property(only.value, 'raw')
    return typeof raw === 'string' ? { text: raw, node: only } : undefined
  }
  return undefined
}

/** The first type argument of `sql.as<T>(...)`, if written. */
export function typeArgumentOf(node: Call): Node | undefined {
  const args = node.typeArguments ?? node.typeParameters
  return isTypeArguments(args) ? args.params[0] : undefined
}

/**
 * Collects `type Name = ...` aliases declared at the top level of the file (exported or
 * not), so an annotation such as `sql.as<User>` can be read without a type checker.
 */
export function collectTypeAliases(program: Node): ReadonlyMap<string, Node> {
  const aliases = new Map<string, Node>()
  const body = program.body
  if (!isNodeArray(body)) return aliases
  for (const statement of body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (!isNode(declaration) || declaration.type !== 'TSTypeAliasDeclaration') continue
    const id = declaration.id
    const annotation = declaration.typeAnnotation
    const name = isNode(id) ? id.name : undefined
    const generic = declaration.typeParameters
    if (
      typeof name === 'string' &&
      isNode(annotation) &&
      (generic === null || generic === undefined)
    ) {
      aliases.set(name, annotation)
    }
  }
  return aliases
}
