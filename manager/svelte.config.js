import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
		// If your environment is not supported or you settled on a specific environment, switch out the adapter.
		// See https://kit.svelte.dev/docs/adapters for more information about adapters.
		adapter: adapter(),
		env: {
			dir: '..'
		},
		version: {
			name: process.env.npm_package_version
		},
		alias: {
			$lib: './src//lib',
			'$lib/*': './src/lib/*',
			'@derzis/models': '../models/src',
			'@derzis/common': '../common/src',
			'@derzis/config': '../config/src',
			'@derzis/manager': './src/lib'
		}
	}
};

export default config;
