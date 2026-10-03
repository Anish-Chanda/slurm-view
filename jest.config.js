export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          target: 'ES2023',
          module: 'Node20',
          moduleResolution: 'Node16',
          jsx: 'react-jsx',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['node', 'jest'],
        },
      },
    ],
    '^.+\\.jsx?$': 'babel-jest',
  },
  // Map explicit `.js` imports to their TypeScript sources during tests.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/tests/**/*.test.[jt]s?(x)'],
  setupFiles: ['<rootDir>/tests/setup-web-globals.js'],
  // Jest must transform these ESM-only packages before loading them.
  transformIgnorePatterns: ['/node_modules/(?!(@tanstack|d3|d3-.*|delaunator|internmap|robust-predicates)/)'],
};
