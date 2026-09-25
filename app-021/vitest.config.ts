import { defineConfig } from 'vitest/config'

// 纯逻辑测试（.ts）跑在 node；需要渲染 DOM 的 .tsx 测试跑在 happy-dom
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['**/*.test.tsx', 'happy-dom']],
    setupFiles: ['tests/setup-dom.ts'],
    testTimeout: 600_000,
  },
})
