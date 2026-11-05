import js from '@eslint/js';
import globals from 'globals';

const unsafeDom = [
  { property: 'innerHTML', message: 'Use html`...` and render() from js/shared/html.js.' },
  { property: 'outerHTML', message: 'Use html`...` and render().' },
  { property: 'insertAdjacentHTML', message: 'Use html`...` and render().' },
  { property: 'createContextualFragment', message: 'Only js/shared/html.js may parse HTML.' },
];

export default [
  { ignores: ['node_modules/**', 'vendor/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-restricted-properties': ['error', ...unsafeDom],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: 'document.write is banned.' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-sequences': 'error',
      eqeqeq: ['error', 'always'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['js/shared/html.js'], rules: { 'no-restricted-properties': 'off' } },
  {
    files: ['tests/**/*.js', 'tools/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
