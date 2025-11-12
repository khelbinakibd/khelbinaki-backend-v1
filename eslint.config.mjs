// eslint.config.mjs
import antfu from '@antfu/eslint-config'

export default antfu({
  // Type of project - 'lib' for libraries, 'app' for applications
  type: 'app',

  // Enable TypeScript support (auto-detected but explicit is better)
  typescript: true,

  // Disable frontend-specific configs
  vue: false,
  react: false,

  // Enable Node.js specific rules
  node: true,

  // Stylistic preferences for backend code
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: false,
  },

  // Ignore common backend files/folders
  ignores: [
    'dist/**',
    'build/**',
    'coverage/**',
    'node_modules/**',
    '*.min.js',
    'public/**',
    'uploads/**',
    'logs/**',
    '.env*',
  ],
}, {
  // Additional custom rules for backend development
  rules: {
    // Console.log is often needed in backend for debugging
    'no-console': 'off',

    // Allow process.env usage
    'node/prefer-global/process': 'off',

    // Allow async without await in middleware
    'require-await': 'off',

    // Backend often has longer functions
    'max-lines-per-function': 'off',

    // TypeScript specific rules
    '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
  },
})
