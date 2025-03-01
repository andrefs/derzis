import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import path from 'path';

const aliases = ['common', 'worker', 'models', 'config'];

export default defineConfig({
  resolve: {
    alias: [
      ...aliases.map((alias) => ({
        find: `@derzis/${alias}`,
        replacement: path.resolve(__dirname, `../${alias}/src/index.ts`)
      })),
      {
        find: `@derzis/manager`,
        replacement: path.resolve(__dirname, `src/index.ts`)
      }
    ]
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  plugins: [sveltekit()],
  test: {
    include: ['manager/**/*.{test,spec}.{js,ts}']
  },
  server: {
    allowedHosts: true
    //port: 59982
  },
  preview: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000
  }
});
