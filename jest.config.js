module.exports = {
  preset: 'ts-jest',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.(spec|test).ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
}
