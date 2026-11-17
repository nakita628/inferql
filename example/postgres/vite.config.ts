import { defineConfig } from 'vite-plus'

import lint from './oxlint.config.js'

// oxlint-disable-next-line import/no-default-export -- Vite resolves the config through its default export
export default defineConfig({ lint })
