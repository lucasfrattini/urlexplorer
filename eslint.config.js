'use strict';

const globals = require('globals');

/** Configuración plana de ESLint 9. */
module.exports = [
  {
    ignores: ['node_modules/**', 'logs/**', 'coverage/**'],
  },

  // Backend: CommonJS sobre Node
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // La config plana de ESLint 9 NO activa no-undef por defecto, a
      // diferencia del viejo eslint:recommended. Sin ella, referenciar una
      // variable que no existe pasa el linter sin decir nada y solo revienta
      // en tiempo de ejecución. Eso es exactamente lo que dejó pasar un
      // `withSizes` sin declarar dentro de findFiles: ReferenceError en cada
      // URL de la fase 2, tragado por el try/catch por URL, y una exploración
      // que devolvía cero ficheros sin un solo error visible.
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      curly: ['error', 'multi-line'],
      'no-throw-literal': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-return-await': 'error',
      'require-atomic-updates': 'off',
    },
  },

  // El pool de Puppeteer es código de Node que ADEMÁS contiene funciones que
  // se serializan y se ejecutan dentro de la página (page.evaluate). Ahí
  // `document` y `window` sí existen, así que el fichero necesita los dos
  // conjuntos de globals para que no-undef no dé falsos positivos.
  {
    files: ['src/lib/browser.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Frontend: ES modules sobre navegador
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // El frontend no debe volver a construir HTML con datos scrapeados
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Usa textContent o los helpers de dom.js: innerHTML reintroduce el XSS.',
        },
        {
          property: 'outerHTML',
          message: 'Usa los helpers de dom.js en vez de outerHTML.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'event', message: 'Usa el parámetro del handler.' },
      ],
    },
  },

  // Tests
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
];
