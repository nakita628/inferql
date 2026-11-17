const pattern = {
  oneOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: { regex: { type: 'string' } },
      required: ['regex'],
      additionalProperties: false,
    },
  ],
} as const

const target = {
  type: 'object',
  properties: { call: pattern, annotate: { type: 'boolean' } },
  required: ['call'],
  additionalProperties: false,
} as const

const connection = {
  type: 'object',
  properties: {
    dialect: { type: 'string' },
    databaseUrl: { type: 'string' },
    migrationsDir: { type: 'string' },
    targets: { type: 'array', items: target },
    overrides: {
      type: 'object',
      properties: { types: { type: 'object', additionalProperties: { type: 'string' } } },
      additionalProperties: false,
    },
    enforceType: { enum: ['fix', 'suggest'] },
  },
  required: ['dialect'],
  additionalProperties: false,
} as const

/** JSON schema of the rule's single options object; oxlint validates configs against it. */
export const optionsSchema = [
  {
    type: 'object',
    properties: {
      connections: { oneOf: [connection, { type: 'array', items: connection, minItems: 1 }] },
    },
    required: ['connections'],
    additionalProperties: false,
  },
] as const
