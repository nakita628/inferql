import { RuleTester } from 'oxlint/plugins-dev'
import { describe, expect, it, test } from 'vite-plus/test'

import plugin, { isTestPath } from './custom.js'

RuleTester.describe = (name, fn) => {
  describe(name, fn)
}
RuleTester.it = (name, fn) => {
  test(name, fn)
}
RuleTester.itOnly = (name, fn) => {
  test.only(name, fn)
}

const tester = new RuleTester({ languageOptions: { sourceType: 'module' } })

function rule(name: string) {
  const found = plugin.rules[name]
  if (found === undefined) throw new Error(`unknown rule ${name}`)
  return found as Parameters<RuleTester['run']>[1]
}

function source(code: string, filename = 'src/x.ts') {
  return { code, filename }
}

describe('isTestPath', () => {
  it('recognises test files', () => {
    expect(isTestPath('a/b.test.ts')).toBe(true)
    expect(isTestPath('a/b.test.tsx')).toBe(true)
    expect(isTestPath('a/b.ts')).toBe(false)
  })
})

tester.run('function-declaration', rule('function-declaration'), {
  valid: [
    source('export function read(input: string) { return input }'),
    // An annotated const keeps its contextual type.
    source('const handler: Handler = (input) => input'),
    // Not a function.
    source('const limit = 10'),
    // Tests are exempt.
    source('const read = (input: string) => input', 'src/x.test.ts'),
  ],
  invalid: [
    { ...source('const read = (input: string) => input'), errors: 1 },
    { ...source('export const read = function (input: string) { return input }'), errors: 1 },
  ],
})

tester.run('type-pascal-case', rule('type-pascal-case'), {
  valid: [source('type UserRow = { id: number }'), source('export type Http2Client = object')],
  invalid: [
    { ...source('type userRow = { id: number }'), errors: 1 },
    { ...source('type user_row = { id: number }'), errors: 1 },
  ],
})

tester.run('predicate-is-name', rule('predicate-is-name'), {
  valid: [
    source('function isEmpty(list: unknown[]) { return list.length === 0 }'),
    source('function hasKey(o: object) { return "k" in o }'),
    // Returns something other than a boolean expression.
    source('function count(list: unknown[]) { return list.length }'),
    // Exempt in tests.
    source('function empty(list: unknown[]) { return list.length === 0 }', 'src/x.test.ts'),
  ],
  invalid: [
    { ...source('function empty(list: unknown[]) { return list.length === 0 }'), errors: 1 },
    { ...source('function ready(x: number) { if (x > 1) return true; return !x }'), errors: 1 },
  ],
})
