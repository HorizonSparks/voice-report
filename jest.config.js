module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // _ops_backup/ contains a frozen snapshot of older test files. Including it
  // means each test gets discovered twice (sometimes with conflicting
  // expectations against a different schema), hanging or polluting the run.
  testPathIgnorePatterns: ['/node_modules/', '/_ops_backup/'],
  collectCoverageFrom: [
    'server/**/*.js',
    'database/**/*.js',
    '!**/node_modules/**',
    '!**/_ops_backup/**',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};
