import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import { readConnection } from './project.js'
import { SchemaCache } from './schema.js'

const example = fileURLToPath(new URL('../../../example/sqlite/', import.meta.url))

describe('SchemaCache', () => {
  it('reads the example’s tables through its own inferql, once', async () => {
    const connection = readConnection(example)
    if (connection === undefined) throw new Error('the example has no inferql connection')
    const cache = new SchemaCache()
    const schema = await cache.get(example, connection)
    expect(schema.tables.map((table) => table.name)).toEqual(['posts', 'users'])
    expect(schema.tables.find((table) => table.name === 'users')?.columns[2]).toEqual({
      name: 'email',
      dataType: 'VARCHAR(255)',
      nullable: true,
      tsType: 'string',
    })
    expect(cache.get(example, connection)).toBe(cache.get(example, connection))
  })
})
