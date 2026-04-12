import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
  resolve: {
    // .js → .ts マッピング（NodeNextのimport文を解決する）
    extensions: ['.ts', '.js'],
  },
});
