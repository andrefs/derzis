
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://kit.svelte.dev/docs/modules#$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://kit.svelte.dev/docs/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://kit.svelte.dev/docs/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://kit.svelte.dev/docs/modules#$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```bash
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const MONGO_INITDB_ROOT_USERNAME: string;
	export const MONGO_INITDB_ROOT_PASSWORD: string;
	export const MONGO_INITDB_DATABASE: string;
	export const MONGO_URI: string;
	export const SHELL: string;
	export const npm_command: string;
	export const WINDOWID: string;
	export const EC2_HOME: string;
	export const npm_config_userconfig: string;
	export const PYENV_SHELL: string;
	export const npm_config_cache: string;
	export const npm_config_loglevel: string;
	export const TERM_PROGRAM_VERSION: string;
	export const PHD_PROJECTS: string;
	export const TMUX: string;
	export const HISTSIZE: string;
	export const NODE: string;
	export const TODOTXT_DEFAULT_ACTION: string;
	export const LC_ADDRESS: string;
	export const AWS_ACCESS_KEY: string;
	export const AWS_SECRET_KEY: string;
	export const OPENER: string;
	export const LC_NAME: string;
	export const SSH_AUTH_SOCK: string;
	export const npm_config_email: string;
	export const PLENV_SHELL: string;
	export const HISTTIMEFORMAT: string;
	export const NOPASTE_SERVICES: string;
	export const MEMORY_PRESSURE_WRITE: string;
	export const TMUX_PLUGIN_MANAGER_PATH: string;
	export const COLOR: string;
	export const npm_config_local_prefix: string;
	export const LC_MONETARY: string;
	export const SSH_AGENT_PID: string;
	export const npm_config_globalconfig: string;
	export const EDITOR: string;
	export const PWD: string;
	export const npm_config_save_prefix: string;
	export const LOGNAME: string;
	export const TEXINPUTS: string;
	export const FREELINGSHARE: string;
	export const MANPATH: string;
	export const npm_config_init_module: string;
	export const SYSTEMD_EXEC_PID: string;
	export const NODE_ENV: string;
	export const _: string;
	export const XAUTHORITY: string;
	export const HOME: string;
	export const LANG: string;
	export const LC_PAPER: string;
	export const HISTFILE: string;
	export const npm_package_version: string;
	export const MEMORY_PRESSURE_WATCH: string;
	export const N_PREFIX: string;
	export const SEMPROX_PROJECTS: string;
	export const INVOCATION_ID: string;
	export const MANAGERPID: string;
	export const INIT_CWD: string;
	export const INFOPATH: string;
	export const npm_lifecycle_script: string;
	export const NVM_DIR: string;
	export const npm_config_npm_version: string;
	export const CONTENTFUL_PROJECTS: string;
	export const LC_IDENTIFICATION: string;
	export const TERM: string;
	export const npm_package_name: string;
	export const npm_config_prefix: string;
	export const USER: string;
	export const EC2_URL: string;
	export const TMUX_PANE: string;
	export const DISPLAY: string;
	export const npm_lifecycle_event: string;
	export const SHLVL: string;
	export const LC_TELEPHONE: string;
	export const LC_MEASUREMENT: string;
	export const SSWP: string;
	export const PERL_CPANM_OPT: string;
	export const npm_config_user_agent: string;
	export const npm_config_save_exact: string;
	export const npm_execpath: string;
	export const CLASSPATH: string;
	export const XDG_RUNTIME_DIR: string;
	export const PYENV_ROOT: string;
	export const LESSSECURE: string;
	export const NOTICIAS2011_HOME: string;
	export const DEBUGINFOD_URLS: string;
	export const npm_package_json: string;
	export const LC_TIME: string;
	export const JOURNAL_STREAM: string;
	export const XDG_DATA_DIRS: string;
	export const npm_config_noproxy: string;
	export const PATH: string;
	export const npm_config_metrics_registry: string;
	export const SAPO_PROJECTS: string;
	export const npm_config_node_gyp: string;
	export const HISTIGNORE: string;
	export const HISTFILESIZE: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const npm_config_global_prefix: string;
	export const MAIL: string;
	export const npm_node_execpath: string;
	export const npm_config_engine_strict: string;
	export const LC_NUMERIC: string;
	export const OLDPWD: string;
	export const TERM_PROGRAM: string;
}

/**
 * Similar to [`$env/static/private`](https://kit.svelte.dev/docs/modules#$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://kit.svelte.dev/docs/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/master/packages/adapter-node) (or running [`vite preview`](https://kit.svelte.dev/docs/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://kit.svelte.dev/docs/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://kit.svelte.dev/docs/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		MONGO_INITDB_ROOT_USERNAME: string;
		MONGO_INITDB_ROOT_PASSWORD: string;
		MONGO_INITDB_DATABASE: string;
		MONGO_URI: string;
		SHELL: string;
		npm_command: string;
		WINDOWID: string;
		EC2_HOME: string;
		npm_config_userconfig: string;
		PYENV_SHELL: string;
		npm_config_cache: string;
		npm_config_loglevel: string;
		TERM_PROGRAM_VERSION: string;
		PHD_PROJECTS: string;
		TMUX: string;
		HISTSIZE: string;
		NODE: string;
		TODOTXT_DEFAULT_ACTION: string;
		LC_ADDRESS: string;
		AWS_ACCESS_KEY: string;
		AWS_SECRET_KEY: string;
		OPENER: string;
		LC_NAME: string;
		SSH_AUTH_SOCK: string;
		npm_config_email: string;
		PLENV_SHELL: string;
		HISTTIMEFORMAT: string;
		NOPASTE_SERVICES: string;
		MEMORY_PRESSURE_WRITE: string;
		TMUX_PLUGIN_MANAGER_PATH: string;
		COLOR: string;
		npm_config_local_prefix: string;
		LC_MONETARY: string;
		SSH_AGENT_PID: string;
		npm_config_globalconfig: string;
		EDITOR: string;
		PWD: string;
		npm_config_save_prefix: string;
		LOGNAME: string;
		TEXINPUTS: string;
		FREELINGSHARE: string;
		MANPATH: string;
		npm_config_init_module: string;
		SYSTEMD_EXEC_PID: string;
		NODE_ENV: string;
		_: string;
		XAUTHORITY: string;
		HOME: string;
		LANG: string;
		LC_PAPER: string;
		HISTFILE: string;
		npm_package_version: string;
		MEMORY_PRESSURE_WATCH: string;
		N_PREFIX: string;
		SEMPROX_PROJECTS: string;
		INVOCATION_ID: string;
		MANAGERPID: string;
		INIT_CWD: string;
		INFOPATH: string;
		npm_lifecycle_script: string;
		NVM_DIR: string;
		npm_config_npm_version: string;
		CONTENTFUL_PROJECTS: string;
		LC_IDENTIFICATION: string;
		TERM: string;
		npm_package_name: string;
		npm_config_prefix: string;
		USER: string;
		EC2_URL: string;
		TMUX_PANE: string;
		DISPLAY: string;
		npm_lifecycle_event: string;
		SHLVL: string;
		LC_TELEPHONE: string;
		LC_MEASUREMENT: string;
		SSWP: string;
		PERL_CPANM_OPT: string;
		npm_config_user_agent: string;
		npm_config_save_exact: string;
		npm_execpath: string;
		CLASSPATH: string;
		XDG_RUNTIME_DIR: string;
		PYENV_ROOT: string;
		LESSSECURE: string;
		NOTICIAS2011_HOME: string;
		DEBUGINFOD_URLS: string;
		npm_package_json: string;
		LC_TIME: string;
		JOURNAL_STREAM: string;
		XDG_DATA_DIRS: string;
		npm_config_noproxy: string;
		PATH: string;
		npm_config_metrics_registry: string;
		SAPO_PROJECTS: string;
		npm_config_node_gyp: string;
		HISTIGNORE: string;
		HISTFILESIZE: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		npm_config_global_prefix: string;
		MAIL: string;
		npm_node_execpath: string;
		npm_config_engine_strict: string;
		LC_NUMERIC: string;
		OLDPWD: string;
		TERM_PROGRAM: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://kit.svelte.dev/docs/modules#$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://kit.svelte.dev/docs/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
