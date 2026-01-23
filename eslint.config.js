import js from '@eslint/js';
import ts from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

const rules = {
  plugins: {
    '@stylistic': stylistic,
    import: importPlugin
  },
  rules: {
    // Possible problems
    'array-callback-return': 'warn',
    'no-constructor-return': 'error',
    'no-duplicate-imports': 'off',   // using 'import/no-duplicates' instead
    'no-promise-executor-return': 'error',
    'no-self-compare': 'error',
    'no-template-curly-in-string': 'warn',
    'no-unmodified-loop-condition': 'error',
    'no-unreachable': 'warn',
    'no-unreachable-loop': 'warn',
    'no-unused-vars': 'off',   // 'typescript-eslint' will check it
    'no-use-before-define': ['off', 'nofunc'],
    'no-useless-backreference': 'warn',

    // Suggestions
    'accessor-pairs': 'error',
    'block-scoped-var': 'error',
    'complexity': ['warn', 50],
    'curly': ['warn', 'multi-line'],
    'default-case-last': 'error',
    'default-param-last': 'error',
    'eqeqeq': ['error', 'smart'],
    'grouped-accessor-pairs': 'error',
    'no-await-in-loop': 'off',
    'no-caller': 'error',
    'no-div-regex': 'error',
    'no-eq-null': 'error',
    'no-eval': 'error',
    'no-extend-native': 'error',
    'no-extra-bind': 'error',
    'no-extra-label': 'error',
    'no-global-assign': 'error',
    'no-implied-eval': 'error',
    'no-invalid-this': 'off',
    'no-labels': 'error',
    'no-label-var': 'error',
    'no-lone-blocks': 'error',
    'no-loop-func': 'error',
    'no-multi-str': 'error',
    'no-new': 'error',
    'no-new-func': 'error',
    'no-new-wrappers': 'error',
    'no-prototype-builtins': 'off',
    'no-restricted-properties': 'error',
    'no-return-assign': 'off',
    'no-script-url': 'error',
    'no-sequences': 'error',
    'no-shadow': 'off',
    'no-shadow-restricted-names': 'error',
    'no-throw-literal': 'error',
    'no-undef-init': 'warn',
    'no-unexpected-multiline': 'error',
    'no-unneeded-ternary': 'error',
    'no-unused-expressions': 'error',
    'no-useless-call': 'warn',
    'no-useless-computed-key': 'warn',
    'no-useless-concat': 'warn',
    'no-useless-constructor': 'off',
    'no-useless-escape': 'off',
    'no-useless-rename': 'warn',
    'no-void': 'error',
    'no-warning-comments': 'warn',
    'radix': ['error', 'always'],
    'require-await': 'off',

    // Stylistic (migrated from deprecated ESLint core rules)
    '@stylistic/arrow-spacing': 'warn',
    '@stylistic/block-spacing': ['warn', 'always'],
    '@stylistic/brace-style': ['warn', '1tbs', { 'allowSingleLine': true }],
    '@stylistic/indent': ['off', 2],
    '@stylistic/keyword-spacing': 'error',
    '@stylistic/linebreak-style': ['error', 'unix'],
    '@stylistic/no-floating-decimal': 'error',
    '@stylistic/no-trailing-spaces': 'warn',
    '@stylistic/no-whitespace-before-property': 'warn',
    '@stylistic/quotes': ['error', 'single', { 'allowTemplateLiterals': 'always' }],
    '@stylistic/semi': ['error', 'always'],
    '@stylistic/semi-spacing': 'error',
    '@stylistic/space-unary-ops': 'error',

    // TypeScript
    '@typescript-eslint/array-type': 'off',
    '@typescript-eslint/class-literal-property-style': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-inferrable-types': ['warn', { 'ignoreParameters': true }],
    '@typescript-eslint/no-this-alias': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { 'vars': 'all', 'args': 'none', 'varsIgnorePattern': '^_', 'caughtErrors': 'none'  }],

    // Import
    'import/no-duplicates': ['warn', { 'prefer-inline': false }]
  }
};


export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...ts.configs.stylistic,
  rules,
  {
    files: [ 'modules/**' ],
    languageOptions: {
      globals: {
        ...globals.browser,
        GeoJSON: false    // Global namespace from `@types/geojson` (UMD declaration)
      }
    },
    rules: {
      'no-console': 'warn',
      'no-process-env': 'error'
    }
  },
  {
    files: [ 'scripts/**', 'test/unit/**' ],
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: false
      }
    }
  },
  {
    files: [ 'test/test_setup.js', 'test/browser/**' ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.mocha,   // describe, it, beforeEach, afterEach, etc.
        Rapid: false,
        d3: false,
        assert: false,   // used by chai
        fetchMock: false
      }
    }
  },
  {
    ignores: [ 'test/benchmark/**' ]
  }
];
