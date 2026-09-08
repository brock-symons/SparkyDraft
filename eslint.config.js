const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const globals = require('globals');

// This app has no build step (see CLAUDE.md / README.md) — files load
// straight into the browser via an in-browser Babel loader, and never
// `import React` even though they use JSX (React comes in as a global
// from the loader). ESLint here is dev-time-only tooling: it never runs
// as part of loading or shipping the app, only as a manual/CI check.
module.exports = [
  {
    ignores: ['legacy-index.html', 'index.html', 'node_modules/**'],
  },
  {
    files: ['app/src/**/*.js', 'app/src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        React: 'readonly',
      },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // No build step means no JSX-runtime import and no prop-types
      // convention here — both would just be false positives.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
    // Not 'detect': React loads from a CDN (see index.html), not npm, so
    // there's no installed package for the plugin to detect a version from.
    settings: { react: { version: '18.3' } },
  },
  {
    files: ['app/test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
