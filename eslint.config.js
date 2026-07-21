// Coded by: Piererra Felldiaz
// Flat config (ESLint v9+). No extra `globals` package dependency —
// runtime globals are declared by hand below, since this bot only needs
// a handful of them.
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
        // Cloudflare Workers runtime (browser-like, not Node) — src/ code
        // runs here, and genuinely has no `global`/`process`/etc., so
        // those stay out of this shared block deliberately: using them
        // in src/ would be a real bug, and no-undef should keep catching
        // that.
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
  {
    // tests/ runs under Node (via `node --test`), not the Workers
    // runtime — `global` is how the mocked fetch gets installed
    // (`global.fetch = ...`), and `process` is occasionally useful too.
    files: ['tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: {
      globals: {
        global: 'writable',
        process: 'readonly',
      },
    },
  },
];
