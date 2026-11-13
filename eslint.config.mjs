import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['coverage/**', 'data/**', 'dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CatchClause > BlockStatement[body.length=0]',
          message:
            'Caught errors must be logged or propagated to a logging boundary; empty catch blocks are not allowed.',
        },
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='Identifier'][body.name='undefined']",
          message:
            'Do not silently discard rejected promises; log the failure or propagate it.',
        },
        {
          selector:
            "CallExpression[callee.property.name='catch'] > :matches(ArrowFunctionExpression, FunctionExpression) > BlockStatement[body.length=0]",
          message: 'Empty promise rejection handlers are not allowed.',
        },
      ],
    },
  },
  prettier,
);
