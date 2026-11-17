// custom.js is an oxlint JS plugin (the alpha ESLint-compatible API), so it is written in
// plain JS. Types are only needed for the parts the verification suite touches.

/** Whether a path is a test file (exempt from the structural rules). */
export declare function isTestPath(filename: string): boolean

declare const plugin: {
  readonly meta: { readonly name: string }
  readonly rules: Record<string, unknown>
}

export default plugin
