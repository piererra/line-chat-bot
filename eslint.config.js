// Flat config (ESLint v9+). No extra `globals` package dependency —
// Workers runtime globals are declared by hand below, since this bot
// only needs a handful of them.
export default [
  {
    ignores: ['node_modules/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Cloudflare Workers runtime (browser-like, not Node)
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        crypto: 'readonly',
        console: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        // Node (test files only, via tests/**.test.mjs override below, but
        // declared globally too since it's harmless for the rest)
        process: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^pier_' }],
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-console': 'off', // this bot deliberately logs failures for Cloudflare's real-time log viewer
    },
  },
];
