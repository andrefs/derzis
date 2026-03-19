const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');
const path = require('path');

const projectRoot = __dirname;

module.exports = [
	{
		...js.configs.recommended,
		rules: {
			// Turn off base ESLint no-undef: TypeScript's compiler handles this check
			'no-undef': 'off',
		}
	},
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module',
				project: './tsconfig.json',
				tsconfigRootDir: projectRoot
			}
		},
		plugins: {
			'@typescript-eslint': tseslint
		},
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
					selector: 'TSAsExpression:not([typeAnnotation.type="TSTypeReference"][typeAnnotation.typeName.name="const"])',
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
	},
	prettier
];
