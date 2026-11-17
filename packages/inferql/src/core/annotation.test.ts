import { describe, expect, it } from 'vite-plus/test'

import { resolveAnnotation } from './annotation.js'
import type { AnnotationContext, TypeNode } from './annotation.js'
import { printTarget } from './target.js'

// Hand-built nodes in the ESTree/TSESTree shape oxlint hands the rule.
function keyword(type: string): TypeNode {
  return { type }
}
function lit(value: unknown): TypeNode {
  return { type: 'TSLiteralType', literal: { type: 'Literal', value } }
}
function ref(name: string, ...params: TypeNode[]): TypeNode {
  return {
    type: 'TSTypeReference',
    typeName: { type: 'Identifier', name },
    ...(params.length > 0
      ? { typeArguments: { type: 'TSTypeParameterInstantiation', params } }
      : {}),
  }
}
function prop(key: string, annotation: TypeNode, optional = false): TypeNode {
  return {
    type: 'TSPropertySignature',
    key: { type: 'Identifier', name: key },
    optional,
    typeAnnotation: { type: 'TSTypeAnnotation', typeAnnotation: annotation },
  }
}
function obj(...members: TypeNode[]): TypeNode {
  return { type: 'TSTypeLiteral', members }
}
function union(...types: TypeNode[]): TypeNode {
  return { type: 'TSUnionType', types }
}

const none: AnnotationContext = { resolveReference: () => undefined }

function print(node: TypeNode, context: AnnotationContext = none): string {
  const result = resolveAnnotation(node, context)
  return result.ok ? printTarget(result.target) : `error: ${result.reason}`
}

describe('resolveAnnotation', () => {
  it('reads keywords, literals and unions', () => {
    expect(print(keyword('TSStringKeyword'))).toBe('string')
    expect(print(union(keyword('TSNumberKeyword'), keyword('TSNullKeyword')))).toBe('number | null')
    expect(print(union(lit('a'), lit(1), lit(true), lit(null)))).toBe("'a' | 1 | true | null")
    expect(print(lit("it's"))).toBe(String.raw`'it\'s'`)
    expect(
      print({
        type: 'TSLiteralType',
        literal: {
          type: 'TemplateLiteral',
          quasis: [{ type: 'TemplateElement', value: { cooked: 'x' } }],
        },
      }),
    ).toBe("'x'")
    expect(
      print({
        type: 'TSLiteralType',
        literal: {
          type: 'UnaryExpression',
          operator: '-',
          argument: { type: 'Literal', value: 2 },
        },
      }),
    ).toBe('-2')
  })

  it('reads object types with optional and quoted keys', () => {
    const node = obj(
      prop('id', keyword('TSNumberKeyword')),
      prop('nick', keyword('TSStringKeyword'), true),
      {
        type: 'TSPropertySignature',
        key: { type: 'Literal', value: 'a-b' },
        typeAnnotation: { type: 'TSTypeAnnotation', typeAnnotation: keyword('TSBooleanKeyword') },
      },
    )
    expect(print(node)).toBe('{ id: number; nick?: string; "a-b": boolean }')
  })

  it('reads arrays in both spellings, parentheses, intersections and well-known globals', () => {
    expect(print({ type: 'TSArrayType', elementType: keyword('TSStringKeyword') })).toBe('string[]')
    expect(print(ref('Array', keyword('TSNumberKeyword')))).toBe('number[]')
    expect(print(ref('ReadonlyArray', union(lit('a'), lit('b'))))).toBe("('a' | 'b')[]")
    expect(print({ type: 'TSParenthesizedType', typeAnnotation: keyword('TSNullKeyword') })).toBe(
      'null',
    )
    expect(
      print({
        type: 'TSIntersectionType',
        types: [
          obj(prop('a', keyword('TSNumberKeyword'))),
          obj(prop('b', keyword('TSStringKeyword'))),
        ],
      }),
    ).toBe('{ a: number; b: string }')
    expect(print(ref('Date'))).toBe('Date')
    expect(print(ref('Buffer'))).toBe('Buffer')
  })

  it('resolves same-file aliases, including nested ones, and refuses cycles', () => {
    const aliases = new Map<string, TypeNode>([
      ['User', obj(prop('id', keyword('TSNumberKeyword')), prop('role', ref('Role')))],
      ['Role', union(lit('admin'), lit('member'))],
      ['Loop', ref('Loop')],
    ])
    const context = { resolveReference: (name: string) => aliases.get(name) }
    expect(print(ref('User'), context)).toBe("{ id: number; role: 'admin' | 'member' }")
    expect(print(ref('Loop'), context)).toBe('error: type `Loop` refers to itself')
  })

  it('explains what it cannot read', () => {
    expect(print(ref('User'))).toContain('not declared in this file')
    expect(print(ref('Partial', keyword('TSStringKeyword')))).toContain(
      'cannot be resolved without a checker',
    )
    expect(print({ type: 'TSTypeReference', typeName: { type: 'TSQualifiedName' } })).toBe(
      'error: qualified type names are not supported',
    )
    expect(print({ type: 'TSMappedType' })).toContain('unsupported type syntax `TSMappedType`')
    expect(print({ type: 'TSIntersectionType', types: [keyword('TSStringKeyword'), obj()] })).toBe(
      'error: only intersections of object types are supported',
    )
    expect(print(obj({ type: 'TSMethodSignature' }))).toContain('unsupported member kind')
    expect(
      print(obj({ type: 'TSPropertySignature', key: { type: 'Identifier', name: 'x' } })),
    ).toContain('no readable key or type')
    expect(print({ type: 'TSLiteralType', literal: { type: 'Literal', value: Symbol('s') } })).toBe(
      'error: unsupported literal type',
    )
  })
})
