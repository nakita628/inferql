import { defineConfig } from 'vite-plus'

import { lintBase } from '../../lint/base.js'

// oxlint-disable-next-line import/no-default-export -- Vite resolves the config through its default export
export default defineConfig({
  pack: {
    entry: { extension: './src/extension.ts' },
    // VS Code loads an extension's `main` with require(); `vscode` is provided by the host, and
    // the project's own inferql is imported at run time from the workspace (src/schema.ts).
    format: ['cjs'],
    platform: 'node',
    external: ['vscode'],
    dts: false,
    outExtensions: () => ({ js: '.cjs' }),
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
  },
  lint: {
    ...lintBase,
    ignorePatterns: ['**/dist/**'],
  },
})
