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
  // Source files use explicit `.js` import suffixes (Node16 resolution).
  // Strip the suffix under Jest so `./foo.js` resolves to `./foo.ts`.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/tests/**/*.test.[jt]s?(x)'],
  // d3 and TanStack Table v9 ship ESM only; transform them instead of
  // ignoring the whole node_modules tree. babel-jest handles the .js output.
  transformIgnorePatterns: ['/node_modules/(?!(@tanstack|d3|d3-.*|delaunator|internmap|robust-predicates)/)'],
};
