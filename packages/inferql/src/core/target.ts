/**
 * The shape of a query result, as inferql reasons about it.
 *
 * Both sides of a comparison are expressed in this form: what the database says the query
 * returns (see `infer.ts`) and what the source annotates (see `annotation.ts`). Printing and
 * comparing then happen on one representation instead of on strings.
 */
export type ResolvedTarget =
  | { readonly kind: 'type'; readonly value: string }
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'union'; readonly value: readonly ResolvedTarget[] }
  | { readonly kind: 'array'; readonly value: ResolvedTarget }
  | { readonly kind: 'object'; readonly value: readonly ResolvedTargetEntry[] }

export type ResolvedTargetEntry = {
  readonly key: string
  readonly optional: boolean
  readonly value: ResolvedTarget
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

export function type(value: string): ResolvedTarget {
  return { kind: 'type', value }
}

export function literal(value: string): ResolvedTarget {
  return { kind: 'literal', value }
}

export function union(value: readonly ResolvedTarget[]): ResolvedTarget {
  return { kind: 'union', value }
}

export function array(value: ResolvedTarget): ResolvedTarget {
  return { kind: 'array', value }
}

export function object(value: readonly ResolvedTargetEntry[]): ResolvedTarget {
  return { kind: 'object', value }
}

export function entry(key: string, value: ResolvedTarget, optional = false): ResolvedTargetEntry {
  return { key, optional, value }
}

function printKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key)
}

/**
 * Renders a target as TypeScript source: `{ id: number; name: string | null }`.
 */
export function printTarget(target: ResolvedTarget): string {
  switch (target.kind) {
    case 'type':
    case 'literal':
      return target.value
    case 'union':
      return target.value.map(printTarget).join(' | ')
    case 'array': {
      const inner = printTarget(target.value)
      return target.value.kind === 'union' ? `(${inner})[]` : `${inner}[]`
    }
    case 'object': {
      if (target.value.length === 0) return '{}'
      const members = target.value.map(
        (member) =>
          `${printKey(member.key)}${member.optional ? '?' : ''}: ${printTarget(member.value)}`,
      )
      return `{ ${members.join('; ')} }`
    }
    default:
      return 'unknown'
  }
}

function rankMember(text: string): number {
  return text === 'null' || text === 'undefined' ? 1 : 0
}

// `null` and `undefined` read best last (`string | null`); everything else is alphabetical.
function compareMembers(a: string, b: string): number {
  return rankMember(a) - rankMember(b) || a.localeCompare(b)
}

function flattenUnion(members: readonly ResolvedTarget[]): ResolvedTarget[] {
  return members.flatMap((member) =>
    member.kind === 'union' ? flattenUnion(member.value) : [normalizeTarget(member)],
  )
}

/**
 * Brings a target into a canonical form: nested unions are flattened, duplicate members are
 * dropped, members are sorted, and a one-member union collapses. Two targets that print the
 * same after normalisation describe the same type.
 */
export function normalizeTarget(target: ResolvedTarget): ResolvedTarget {
  switch (target.kind) {
    case 'type':
    case 'literal':
      return target
    case 'array':
      return array(normalizeTarget(target.value))
    case 'object':
      return object(
        target.value.map((member) =>
          entry(member.key, normalizeTarget(member.value), member.optional),
        ),
      )
    case 'union': {
      const seen = new Map<string, ResolvedTarget>()
      for (const member of flattenUnion(target.value)) {
        seen.set(printTarget(member), member)
      }
      const members = [...seen.entries()]
        .toSorted(([a], [b]) => compareMembers(a, b))
        .map(([, member]) => member)
      const [only] = members
      return members.length === 1 && only !== undefined ? only : union(members)
    }
    default:
      return target
  }
}

export function isSameTarget(a: ResolvedTarget, b: ResolvedTarget): boolean {
  return printTarget(normalizeTarget(a)) === printTarget(normalizeTarget(b))
}
