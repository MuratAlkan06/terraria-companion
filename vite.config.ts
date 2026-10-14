/// <reference types="vitest/config" />
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Alias } from 'vite'

/**
 * react-router 7.18.4 maps every export condition of `react-router` and `react-router/dom` to its
 * dist/development build (the package has no production condition), so Vite's default
 * `development|production` condition can't select the production build and every `vite build`
 * shipped React Router's dev warnings (ENABLE_DEV_WARNINGS = true). For builds, both entry points
 * are aliased to the package's own dist/production files — the same code with the dev warnings
 * switched off. Both must move together: they share one internal chunk, and two copies of React
 * Router would mean two router contexts. `vite` (dev server) and vitest keep the development build.
 */
const reactRouterDir = dirname(createRequire(import.meta.url).resolve('react-router/package.json'))

export const REACT_ROUTER_PRODUCTION_ALIASES: Alias[] = [
  { find: /^react-router$/, replacement: join(reactRouterDir, 'dist/production/index.mjs') },
  { find: /^react-router\/dom$/, replacement: join(reactRouterDir, 'dist/production/dom-export.mjs') },
]

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: command === 'build' ? { alias: REACT_ROUTER_PRODUCTION_ALIASES } : {},
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'pipeline/**/*.test.ts', 'vite.config.test.ts'],
  },
}))
