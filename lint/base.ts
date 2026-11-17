// The oxlint rule set every workspace package shares. Strict by design: exceptions live next to
// the code as `oxlint-disable-next-line` with a reason, never as `'off'` here. A rule that does
// not fit this codebase at all is left out of the list entirely, with a comment where it would
// have gone saying why.
//
// Rules in the correctness / suspicious / perf categories are already errors via `categories`
// and are not restated; the list only adds rules from the pedantic / style / restriction /
// nursery categories, which no category enables. The set mirrors nakita628/hono-takibi minus
// its Effect-specific rules; inferql runs inside an oxlint worker and stays plain TypeScript.
import type { OxlintConfig } from 'oxlint'

export const lintOptions: OxlintConfig['options'] = {
  typeAware: true,
  typeCheck: true,
  // A rule that stops firing must have its `oxlint-disable` comment deleted with it,
  // otherwise the suppression silently outlives its reason.
  reportUnusedDisableDirectives: 'deny',
  // Nothing here is configured as a warning; this keeps a rule that defaults to `warn`
  // from slipping through `vp check` unnoticed.
  denyWarnings: true,
}

export const lintCategories: OxlintConfig['categories'] = {
  correctness: 'error',
  suspicious: 'error',
  perf: 'error',
}

export const lintRules: OxlintConfig['rules'] = {
  'custom/function-declaration': 'error',
  'custom/predicate-is-name': 'error',
  'custom/type-pascal-case': 'error',
  // `@internal` and friends are modifiers, so their text belongs to the description;
  // `check-tag-names` is what catches a tag that is merely misspelled.
  'jsdoc/empty-tags': 'error',
  'jsdoc/check-tag-names': 'error',
  eqeqeq: 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  'no-param-reassign': ['error', { props: true }],
  'no-console': 'error',
  'no-plusplus': 'error',
  'no-underscore-dangle': 'error',
  // Paired with `env: { node: true }`, so `process` resolves and a typo does not.
  'no-undef': 'error',
  'typescript/no-explicit-any': 'error',
  'typescript/no-non-null-assertion': 'error',
  'typescript/consistent-type-imports': 'error',
  'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
  'typescript/no-misused-promises': 'error',
  'typescript/require-await': 'error',
  'typescript/prefer-readonly': 'error',
  'typescript/prefer-nullish-coalescing': 'error',
  'typescript/switch-exhaustiveness-check': 'error',
  'typescript/no-unsafe-argument': 'error',
  'typescript/no-unsafe-assignment': 'error',
  'typescript/no-unsafe-member-access': 'error',
  'typescript/no-unsafe-call': 'error',
  'typescript/no-unsafe-return': 'error',
  'unicorn/no-array-for-each': 'error',
  'unicorn/prefer-array-some': 'error',
  'unicorn/prefer-spread': 'error',
  'unicorn/prefer-string-replace-all': 'error',
  'import/no-cycle': 'error',
  'import/no-duplicates': 'error',
  'no-new-func': 'error',
  'no-return-assign': 'error',
  'no-else-return': 'error',
  'no-lonely-if': 'error',
  'prefer-object-spread': 'error',
  'symbol-description': 'error',
  'typescript/no-deprecated': 'error',
  'typescript/restrict-plus-operands': 'error',
  'typescript/no-confusing-void-expression': 'error',
  'typescript/only-throw-error': 'error',
  'typescript/prefer-promise-reject-errors': 'error',
  'typescript/prefer-reduce-type-parameter': 'error',
  'typescript/prefer-includes': 'error',
  'typescript/prefer-string-starts-ends-with': 'error',
  'typescript/prefer-optional-chain': 'error',
  'typescript/use-unknown-in-catch-callback-variable': 'error',
  'typescript/return-await': 'error',
  'unicorn/no-await-expression-member': 'error',
  'unicorn/prefer-node-protocol': 'error',
  'unicorn/prefer-string-slice': 'error',
  'unicorn/prefer-at': 'error',
  'unicorn/explicit-length-check': 'error',
  'unicorn/throw-new-error': 'error',
  'import/no-default-export': 'error',
  'import/no-mutable-exports': 'error',
  'import/first': 'error',

  // Escape hatches out of the type system, and the unsound types that survive `strict`.
  'typescript/ban-ts-comment': 'error',
  'typescript/prefer-ts-expect-error': 'error',
  'typescript/no-unsafe-function-type': 'error',
  'typescript/no-empty-object-type': 'error',
  'typescript/no-invalid-void-type': 'error',
  'typescript/no-non-null-asserted-nullish-coalescing': 'error',
  'typescript/non-nullable-type-assertion-style': 'error',
  'typescript/no-dynamic-delete': 'error',
  'typescript/strict-void-return': 'error',

  // Declaration style. `consistent-type-definitions: 'type'` locks in the repo-wide
  // `type X = {...}`; the default of this rule is the opposite ('interface'), so the
  // option is load-bearing, not decoration.
  'typescript/consistent-type-definitions': ['error', 'type'],
  'typescript/consistent-type-exports': 'error',
  'typescript/consistent-generic-constructors': 'error',
  'typescript/array-type': 'error',
  'typescript/method-signature-style': 'error',
  'typescript/no-inferrable-types': 'error',
  'typescript/dot-notation': 'error',
  'typescript/prefer-for-of': 'error',
  'typescript/prefer-find': 'error',
  'typescript/prefer-function-type': 'error',
  // ESM-only packages: a `require` call would not survive the build.
  'typescript/no-require-imports': 'error',
  'typescript/no-import-type-side-effects': 'error',

  // Rejections and throws must carry an Error, or the diagnostic reads `[object Object]`.
  'no-throw-literal': 'error',
  'unicorn/error-message': 'error',
  'unicorn/prefer-type-error': 'error',

  // Node / ESM hygiene.
  'unicorn/prefer-module': 'error',
  'unicorn/prefer-global-this': 'error',
  'unicorn/require-module-specifiers': 'error',
  'unicorn/prefer-export-from': 'error',
  'unicorn/prefer-import-meta-properties': 'error',
  'unicorn/no-abusive-eslint-disable': 'error',
  'unicorn/no-anonymous-default-export': 'error',

  // String and array work.
  'prefer-template': 'error',
  'no-useless-concat': 'error',
  'no-multi-str': 'error',
  'unicorn/consistent-template-literal-escape': 'error',
  'unicorn/consistent-existence-index-check': 'error',
  'unicorn/require-array-join-separator': 'error',
  'unicorn/prefer-negative-index': 'error',
  'unicorn/prefer-array-index-of': 'error',
  'unicorn/prefer-array-flat': 'error',
  'unicorn/prefer-object-from-entries': 'error',
  'unicorn/prefer-string-trim-start-end': 'error',
  'unicorn/prefer-native-coercion-functions': 'error',
  'unicorn/consistent-empty-array-spread': 'error',
  'unicorn/prefer-single-call': 'error',
  'unicorn/no-useless-collection-argument': 'error',
  'unicorn/no-useless-fallback-in-spread': 'error',
  'unicorn/no-unnecessary-array-flat-depth': 'error',
  'unicorn/no-magic-array-flat-depth': 'error',
  'unicorn/no-unnecessary-slice-end': 'error',
  'unicorn/no-length-as-slice-end': 'error',
  'unicorn/no-unreadable-array-destructuring': 'error',
  'unicorn/no-immediate-mutation': 'error',

  // Regex and numbers.
  'unicorn/prefer-regexp-test': 'error',
  'prefer-regex-literals': 'error',
  'require-unicode-regexp': 'error',
  'no-div-regex': 'error',
  'no-regex-spaces': 'error',
  'unicorn/prefer-number-properties': 'error',
  'unicorn/prefer-math-min-max': 'error',
  'unicorn/prefer-math-trunc': 'error',
  'unicorn/prefer-modern-math-apis': 'error',
  'unicorn/numeric-separators-style': 'error',
  'unicorn/no-zero-fractions': 'error',
  'unicorn/escape-case': 'error',
  'unicorn/no-hex-escape': 'error',
  radix: 'error',
  'prefer-numeric-literals': 'error',
  'prefer-exponentiation-operator': 'error',
  'unicorn/no-typeof-undefined': 'error',

  // Control flow and declarations. `curly` is `multi-line` rather than `all` so the
  // guard-clause form (`if (!x) return null` on one line) stays legal, while a body
  // that wraps onto its own line must be braced.
  curly: ['error', 'multi-line'],
  'no-useless-return': 'error',
  'unicorn/no-lonely-if': 'error',
  'unicorn/prefer-logical-operator-over-ternary': 'error',
  'unicorn/prefer-default-parameters': 'error',
  'unicorn/no-object-as-default-parameter': 'error',
  'unicorn/no-unreadable-iife': 'error',
  'unicorn/no-useless-switch-case': 'error',
  'default-case-last': 'error',
  'default-param-last': 'error',
  'no-fallthrough': 'error',
  'no-case-declarations': 'error',
  'array-callback-return': 'error',
  'no-loop-func': 'error',
  'no-inner-declarations': 'error',
  'block-scoped-var': 'error',
  'init-declarations': 'error',
  'no-redeclare': 'error',
  'no-multi-assign': 'error',
  'no-sequences': 'error',
  'no-useless-assignment': 'error',
  'no-unreachable-loop': 'error',
  // Hoisted `function` declarations are safe to reference above their definition;
  // `const` / `class` are the TDZ hazard this rule is for.
  'no-use-before-define': ['error', { functions: false }],
  'func-style': ['error', 'declaration', { allowArrowFunctions: true }],
  'arrow-body-style': 'error',
  'prefer-arrow-callback': 'error',
  'guard-for-in': 'error',
  'no-labels': 'error',
  'no-label-var': 'error',
  'no-extra-label': 'error',
  'no-lone-blocks': 'error',
  yoda: 'error',
  'no-self-compare': 'error',

  // Objects and globals.
  'object-shorthand': 'error',
  'operator-assignment': 'error',
  'prefer-object-has-own': 'error',
  'no-prototype-builtins': 'error',
  'no-object-constructor': 'error',
  'no-array-constructor': 'error',
  'no-new-wrappers': 'error',
  'unicorn/new-for-builtins': 'error',
  'prefer-rest-params': 'error',
  'no-implicit-globals': 'error',
  'no-extra-bind': 'error',
  'no-useless-computed-key': 'error',
  'unicorn/no-useless-promise-resolve-reject': 'error',
  'unicorn/prefer-structured-clone': 'error',
  'unicorn/prefer-optional-catch-binding': 'error',
  'unicorn/catch-error-name': ['error', { name: 'error' }],

  // Code injection surfaces (`eval` itself is already `correctness`).
  'no-script-url': 'error',
  'no-bitwise': 'error',
  // `void promise` is the marker `typescript/no-floating-promises` prescribes for a
  // deliberate fire-and-forget; `void 0` stays banned.
  'no-void': ['error', { allowAsStatement: true }],
  'no-empty': 'error',
  'no-empty-function': 'error',
  'unicode-bom': 'error',
  'new-cap': ['error', { capIsNew: false }],
  // A parked TODO is debt that belongs in an issue, not in the source.
  'no-warning-comments': 'error',
  // A `${...}` inside a single-quoted string is almost always a template literal
  // that lost its backticks.
  'no-template-curly-in-string': 'error',

  // promise / node rules sit outside the enabled categories, so the ones that matter
  // for async Node code are named explicitly.
  'promise/param-names': 'error',
  'promise/valid-params': 'error',
  'promise/spec-only': 'error',
  'promise/no-new-statics': 'error',
  'promise/no-multiple-resolved': 'error',
  'promise/no-return-wrap': 'error',
  'promise/no-return-in-finally': 'error',
  'promise/no-nesting': 'error',
  'promise/no-promise-in-callback': 'error',
  'promise/no-callback-in-promise': 'error',
  'promise/catch-or-return': 'error',
  'promise/always-return': 'error',
  'promise/prefer-catch': 'error',
  'node/no-exports-assign': 'error',
  'node/no-new-require': 'error',
  'node/no-mixed-requires': 'error',
  'node/global-require': 'error',
  'node/no-path-concat': 'error',
  'node/handle-callback-err': 'error',
  'node/callback-return': 'error',

  // Module graph. `extensions` keeps relative specifiers `.js`-suffixed, which
  // NodeNext resolution requires at runtime and `tsc` does not check.
  'import/extensions': ['error', 'always', { ignorePackages: true }],
  'import/export': 'error',
  'import/unambiguous': 'error',
  'import/no-commonjs': 'error',
  'import/no-named-default': 'error',
  'import/no-unassigned-import': 'error',
  'import/no-named-as-default': 'error',
  'import/no-anonymous-default-export': 'error',
  'import/consistent-type-specifier-style': 'error',
  'import/no-self-import': 'error',
  'import/no-absolute-path': 'error',
  'import/no-empty-named-blocks': 'error',
  'no-shadow-restricted-names': 'error',
  'no-delete-var': 'error',
}

/** The `lint` block shared by every package; spread it and add what is package-specific. */
export const lintBase: OxlintConfig = {
  // Node-only packages: declaring the runtime is what lets rules that resolve globals
  // (`no-undef`, `unicorn/prefer-global-this`) tell `process` apart from a typo.
  env: { node: true, es2024: true },
  // Setting `plugins` replaces oxlint's default list — restate the defaults, then add
  // import / promise / node / jsdoc.
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'promise', 'node', 'jsdoc'],
  // The repository conventions a glob cannot express (function declarations, predicate
  // naming, type naming); see lint/custom.js.
  jsPlugins: ['../../lint/custom.js'],
  options: lintOptions,
  categories: lintCategories,
  rules: lintRules,
}
