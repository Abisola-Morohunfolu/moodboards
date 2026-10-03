const base = {
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleNameMapper: {
    '^@moodboard/contracts$': '<rootDir>/packages/contracts/src',
    '^@moodboard/database$': '<rootDir>/packages/database/src',
  },
  setupFiles: ['<rootDir>/tests/setup.ts'],
};
module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/**/*.unit.spec.ts'] },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/**/*.integration.spec.ts'],
    },
    { ...base, displayName: 'e2e', testMatch: ['<rootDir>/tests/**/*.e2e.spec.ts'] },
  ],
  testTimeout: 15000,
};
