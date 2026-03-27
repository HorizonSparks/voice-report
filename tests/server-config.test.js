/**
 * SERVER CONFIGURATION TESTS
 * Validates server setup, security, and configuration correctness.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Server security configuration', () => {

  let indexContent;

  beforeAll(() => {
    indexContent = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  });

  test('required directories are created on startup', () => {
    // Verify the server creates necessary directories
    const requiredDirs = ['audio', 'photos', 'forms', 'certs', 'message-photos', 'message-audio'];
    requiredDirs.forEach(dir => {
      expect(indexContent).toContain(dir);
    });
  });

  test('SSL cert paths are referenced', () => {
    expect(indexContent).toContain('cert.pem');
    expect(indexContent).toContain('key.pem');
  });
});

describe('Database configuration', () => {

  let dbContent;

  beforeAll(() => {
    dbContent = fs.readFileSync(path.join(ROOT, 'database', 'db.js'), 'utf8');
  });

  test('uses PostgreSQL (pg) driver', () => {
    expect(dbContent).toMatch(/require\(['"]pg['"]\)/);
  });

  test('uses parameterized queries (no SQL injection)', () => {
    // Check for parameterized queries ($1, $2 pattern)
    expect(dbContent).toMatch(/\$\d+/);
    // Should NOT have string concatenation with user input in queries
    // This is a basic check — not exhaustive
    expect(dbContent).not.toMatch(/`SELECT.*\$\{req\./);
  });
});

describe('Dead code detection', () => {

  test('db-sqlite.js exists but is not imported by server', () => {
    const sqlitePath = path.join(ROOT, 'database', 'db-sqlite.js');
    const sqliteExists = fs.existsSync(sqlitePath);

    if (sqliteExists) {
      // Check that no server file imports it
      const serverIndex = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
      expect(serverIndex).not.toContain('db-sqlite');
    }
  });

  test('db-pg.js exists but is not imported by server', () => {
    const pgDupPath = path.join(ROOT, 'database', 'db-pg.js');
    const pgDupExists = fs.existsSync(pgDupPath);

    if (pgDupExists) {
      const serverIndex = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
      expect(serverIndex).not.toContain('db-pg');
    }
  });
});

describe('Project structure', () => {

  test('all required route files exist', () => {
    const requiredRoutes = [
      'auth.js', 'ai.js', 'messages.js', 'tasks.js',
      'people.js', 'reports.js', 'dailyPlans.js', 'forms.js',
      'formsV2.js', 'jsa.js', 'webauthn.js', 'analytics.js',
      'files.js', 'settings.js', 'punchList.js', 'templates.js',
    ];

    requiredRoutes.forEach(file => {
      const filePath = path.join(ROOT, 'server', 'routes', file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  test('schema.sql exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'database', 'schema.sql'))).toBe(true);
  });

  test('i18n translations exist', () => {
    const i18nDir = path.join(ROOT, 'client', 'src', 'i18n');
    expect(fs.existsSync(i18nDir)).toBe(true);
  });
});
