import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import { createMapperHandlers, migrationModule, migrationNames, respond } from './content-mapper.js'

const fixtures = fileURLToPath(new URL('./rules/fixtures/', import.meta.url))
const migrations = path.join(fixtures, 'migrations')
const tsconfig = path.join(fixtures, 'tsconfig.json')

function open(options: Record<string, unknown>) {
  const handlers = createMapperHandlers()
  const opened = handlers.openProject?.({ projectHandle: 'p', configFileName: tsconfig, options })
  return { handlers, opened }
}

function transform(handlers: ReturnType<typeof createMapperHandlers>, file: string) {
  return handlers.transform?.({
    projectHandle: 'p',
    fileName: file,
    content: readFileSync(file, 'utf8'),
  })
}

describe('content mapper', () => {
  it('registers each migration under its position in name order', () => {
    const { handlers } = open({ dialect: 'sqlite', migrationsDir: 'migrations' })
    const second = path.join(migrations, '002_posts.sql')
    expect(transform(handlers, second)).toEqual({
      extension: '.ts',
      text: migrationModule(1, 'sqlite', readFileSync(second, 'utf8')),
      mappings: [],
    })
    expect(migrationNames(migrations)).toEqual(['001_users.sql', '002_posts.sql'])
  })

  it('writes the text as a string literal type, escapes included', () => {
    expect(migrationModule(0, 'pg', "CREATE TABLE t (a text DEFAULT 'x\"y')\n")).toContain(
      `0: { readonly dialect: "pg"; readonly sql: "CREATE TABLE t (a text DEFAULT 'x\\"y')\\n" }`,
    )
  })

  it('registers nothing for a .sql file outside the migrations directory', () => {
    const { handlers } = open({ dialect: 'sqlite', migrationsDir: 'migrations-postgres' })
    expect(transform(handlers, path.join(migrations, '001_users.sql'))).toEqual({
      extension: '.ts',
      text: 'export {}\n',
      mappings: [],
    })
  })

  it('watches the migrations directory and names its files in the identity', () => {
    const { opened } = open({ dialect: 'sqlite' })
    expect(opened).toEqual({
      configIdentity: JSON.stringify(['sqlite', migrations, ['001_users.sql', '002_posts.sql']]),
      watchedFiles: [migrations],
      optionDiagnostics: [],
    })
  })

  it('reports an unknown dialect on the option', () => {
    const { opened } = open({ dialect: 'oracle' })
    expect(opened).toMatchObject({
      optionDiagnostics: [
        {
          path: ['dialect'],
          messageText:
            'inferql does not know the dialect `oracle`; use one of sqlite, mysql, mariadb, postgres, postgresql, pg.',
        },
      ],
    })
  })

  it('answers requests, rejects unknown methods and ignores notifications', () => {
    const handlers = createMapperHandlers()
    expect(respond(handlers, { jsonrpc: '2.0', method: 'initialized' })).toBeUndefined()
    expect(respond(handlers, { jsonrpc: '2.0', id: 1, method: 'nope' })).toContain('"code":-32601')
    const reply = respond(handlers, { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} })
    expect(reply).toMatch(/^Content-Length: \d+\r\n\r\n/u)
    expect(reply).toContain('"diagnosticSource":"inferql"')
  })
})

describe('content mapper process (dist/mapper.js)', () => {
  it('speaks the protocol over stdio the way TypeScript starts it', async () => {
    const mapper = fileURLToPath(new URL('../dist/mapper.js', import.meta.url))
    const child = spawn(process.execPath, [mapper], { stdio: ['pipe', 'pipe', 'inherit'] })
    const replies: unknown[] = []
    let buffer = Buffer.alloc(0)
    const done = new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
          const headerEnd = buffer.indexOf('\r\n\r\n')
          if (headerEnd === -1) break
          const length = Number(
            /Content-Length: (\d+)/u.exec(buffer.subarray(0, headerEnd).toString())?.[1],
          )
          if (buffer.length < headerEnd + 4 + length) break
          replies.push(
            JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString()),
          )
          buffer = buffer.subarray(headerEnd + 4 + length)
        }
        if (replies.length === 3) resolve()
      })
    })
    function send(id: number, method: string, params: unknown) {
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }
    send(1, 'initialize', { protocolVersion: 1 })
    send(2, 'openProject', {
      projectHandle: 'p',
      configFileName: tsconfig,
      options: { dialect: 'sqlite' },
    })
    const first = path.join(migrations, '001_users.sql')
    send(3, 'transform', {
      projectHandle: 'p',
      fileName: first,
      content: readFileSync(first, 'utf8'),
    })
    await done
    child.stdin.end()
    expect(replies[2]).toMatchObject({
      id: 3,
      result: { extension: '.ts', text: migrationModule(0, 'sqlite', readFileSync(first, 'utf8')) },
    })
  })
})
