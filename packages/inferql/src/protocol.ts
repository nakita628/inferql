import type { ConnectionConfig, ResolvedTarget } from './core/index.js'

/** What the rule sends to the worker for one query: the text and where to check it. */
export type CheckRequest = {
  readonly connection: ConnectionConfig
  readonly projectDir: string
  readonly text: string
}

export type CheckResponse =
  | {
      readonly ok: true
      readonly target: ResolvedTarget
      readonly unknownColumns: readonly string[]
      readonly duplicateColumns: readonly string[]
      /** `undefined` when the dialect cannot count parameters. */
      readonly parameterCount: number | undefined
    }
  | {
      readonly ok: false
      readonly kind: 'query'
      readonly message: string
      /** 0-based offset into the query text, when the database reports one. */
      readonly position: number | undefined
    }
  | {
      readonly ok: false
      readonly kind: 'dialect' | 'connection' | 'migration'
      readonly message: string
    }
