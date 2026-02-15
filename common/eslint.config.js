module.exports = {
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'prettier'
	],
	parser: '@typescript-eslint/parser',
	plugins: ['@typescript-eslint'],
	parserOptions: {
		sourceType: 'module',
		ecmaVersion: 2020
	},
	env: {
		es2017: true,
		node: true
	},
	files: ['src/**/*.ts'],
	rules: {
		'@typescript-eslint/await-thenable': 'error',
		'@typescript-eslint/no-floating-promises': 'error'
	}
};
