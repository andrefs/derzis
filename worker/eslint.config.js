const path = require('path');
const projectRoot = __dirname;

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
		ecmaVersion: 2020,
		project: './tsconfig.json',
		tsconfigRootDir: projectRoot
	},
	env: {
		es2017: true,
		node: true
	},
	files: ['src/**/*.ts'],
	rules: {
		'@typescript-eslint/await-thenable': 'error',
		'@typescript-eslint/no-floating-promises': 'error',
		'@typescript-eslint/no-explicit-any': 'error',
		'@typescript-eslint/no-unsafe-assignment': 'error',
		'@typescript-eslint/no-unsafe-member-access': 'error',
		'@typescript-eslint/no-unsafe-call': 'error',
		'@typescript-eslint/no-unsafe-return': 'error',
		'no-restricted-syntax': [
			'error',
			{
				selector: 'TSAsExpression',
				message: 'Use of "as" type casting is not allowed. Use proper typing instead.'
			},
			{
				selector: 'TSSatisfiesExpression',
				message: 'Use of "satisfies" type casting is not allowed. Use proper typing instead.'
			},
			{
				selector: 'TSNonNullExpression',
				message: 'Use of "!" non-null assertion is not allowed. Use proper null checks instead.'
			}
		]
	}
};
