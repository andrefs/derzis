import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import path from 'path';
import { loadEnv } from 'vite';

const aliases = ['common', 'worker', 'models', 'config'];

export default defineConfig(() => {
  const envDir = path.resolve(__dirname, '../');
  const env = loadEnv('', envDir, '')
  return {
    envDir,
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
      },

    },
    plugins: [sveltekit()],
    test: {
      include: ['manager/**/*.{test,spec}.{js,ts}']
    },
    server: {
      allowedHosts: true as true,
      port: env.DERZIS_MNG_PORT ? parseInt(env.DERZIS_MNG_PORT) : 3000
    },
  }
});
