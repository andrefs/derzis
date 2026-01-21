import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@derzis/models': resolve(__dirname, '../models/src'),
      '@derzis/common': resolve(__dirname, '../common/src'),
      '@derzis/config': resolve(__dirname, '../config/src'),
    },
  },
  test: {
    environment: 'node',
  },
});