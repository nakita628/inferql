import { runAsWorker } from 'synckit'

import { inferResultTarget } from './core/index.js'
import type { CheckRequest, CheckResponse } from './protocol.js'
import { isStageError, session } from './session.js'
import type { Session } from './session.js'

async function describe(request: CheckRequest, current: Session): Promise<CheckResponse> {
  const described = await current.connection.describe(request.text)
  if (!described.ok) {
    return { ok: false, kind: 'query', message: described.message, position: described.position }
  }
  const learned = described.types ?? {}
  const inferred = inferResultTarget(described.columns, {
    toTsType: (dataType) => learned[dataType] ?? current.dialect.toTsType(dataType),
    overrides: request.connection.overrides,
  })
  return {
    ok: true,
    target: inferred.target,
    unknownColumns: inferred.unknownColumns,
    duplicateColumns: inferred.duplicateColumns,
    parameterCount: described.parameters?.length,
  }
}

function setupFailure(error: unknown): CheckResponse {
  const stage = isStageError(error) ? error.stage : 'connection'
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, kind: stage, message }
}

async function check(request: CheckRequest): Promise<CheckResponse> {
  const opened = await session(request.connection, request.projectDir).then(
    (current) => ({ ok: true as const, current }),
    (error: unknown) => ({ ok: false as const, response: setupFailure(error) }),
  )
  if (!opened.ok) return opened.response
  const { current } = opened
  const key = JSON.stringify([request.text, request.connection.overrides])
  const cached = current.results.get(key)
  if (cached !== undefined) return cached
  const response = await describe(request, current)
  current.results.set(key, response)
  return response
}

runAsWorker(check)
