export { resolveAnnotation } from './annotation.js'
export type { AnnotationContext, AnnotationResult, TypeNode } from './annotation.js'
export { connectionsOf, matchesPattern } from './config.js'
export type { Config, ConnectionConfig, Pattern, Target } from './config.js'
export { describeFailure } from './dialect.js'
export type {
  ColumnNullability,
  ConnectContext,
  Connection,
  DescribeResult,
  DescribedColumn,
  DescribedParameter,
  Dialect,
  IntrospectedColumn,
  IntrospectedTable,
  IntrospectResult,
} from './dialect.js'
export { inferResultTarget, parseTypeText } from './infer.js'
export type { InferOptions, InferResult, TypeOverrides } from './infer.js'
export {
  array,
  entry,
  isSameTarget,
  literal,
  normalizeTarget,
  object,
  printTarget,
  type,
  union,
} from './target.js'
export type { ResolvedTarget, ResolvedTargetEntry } from './target.js'
