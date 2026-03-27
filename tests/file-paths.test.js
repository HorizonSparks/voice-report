/**
 * FILE PATH VALIDATION TESTS
 * Ensures all file paths referenced in the codebase resolve to existing files/directories.
 * These paths were previously broken and fixed — these tests prevent regressions.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_ROUTES = path.join(ROOT, 'server', 'routes');

describe('Critical file paths exist', () => {

  test('safety_basics.json exists at project root', () => {
    const filePath = path.join(ROOT, 'safety_basics.json');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('knowledge directory exists at project root', () => {
    const dirPath = path.join(ROOT, 'knowledge');
    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });

  test('templates directory exists at project root', () => {
    const dirPath = path.join(ROOT, 'templates');
    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });

  test('messages directory exists at project root', () => {
    const dirPath = path.join(ROOT, 'messages');
    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });

  test('audio directory exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'audio'))).toBe(true);
  });

  test('photos directory exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'photos'))).toBe(true);
  });

  test('certs directory exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'certs'))).toBe(true);
  });

  test('forms directory exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'forms'))).toBe(true);
  });

  test('message-photos directory exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'message-photos'))).toBe(true);
  });

  test('message-audio directory exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'message-audio'))).toBe(true);
  });
});

describe('AI file path references are correct (in extracted modules)', () => {

  let contextLoaderContent;
  let aiContent;

  beforeAll(() => {
    contextLoaderContent = fs.readFileSync(path.join(ROOT, 'server/services/ai/contextLoader.js'), 'utf8');
    aiContent = fs.readFileSync(path.join(SERVER_ROUTES, 'ai.js'), 'utf8');
  });

  test('contextLoader uses correct ROOT path for safety_basics.json', () => {
    // contextLoader resolves paths from its own __dirname (server/services/ai/) using ROOT constant
    expect(contextLoaderContent).toContain("path.join(ROOT, 'safety_basics.json')");
  });

  test('contextLoader uses correct ROOT path for templates', () => {
    expect(contextLoaderContent).toContain("path.join(ROOT, 'templates'");
  });

  test('refineKnowledgeLoader uses correct ROOT path for knowledge', () => {
    const rkContent = fs.readFileSync(path.join(ROOT, 'server/services/ai/refineKnowledgeLoader.js'), 'utf8');
    expect(rkContent).toContain("path.join(ROOT, 'knowledge')");
  });

  test('ai.js does NOT use SQLite DB.prepare() API', () => {
    expect(aiContent).not.toMatch(/DB\.prepare\(/);
  });

  test('ai.js audio path uses ../../ prefix', () => {
    expect(aiContent).toMatch(/path\.join\(__dirname,\s*['"]\.\.\/\.\.\/audio['"]\)/);
  });
});

describe('analytics.js uses async/await', () => {

  let analyticsContent;

  beforeAll(() => {
    analyticsContent = fs.readFileSync(path.join(SERVER_ROUTES, 'analytics.js'), 'utf8');
  });

  test('route handlers are async', () => {
    // All route handler callbacks should be async (may have middleware before them)
    const routeLines = analyticsContent.split('\n').filter(l => /router\.(get|post)\(/.test(l));
    expect(routeLines.length).toBeGreaterThan(0);
    routeLines.forEach(line => {
      expect(line).toContain('async');
    });
  });

  test('analytics calls use await', () => {
    // trackClientEvents should be awaited
    expect(analyticsContent).toMatch(/await\s+analytics\.trackClientEvents/);
    // getDashboard should be awaited
    expect(analyticsContent).toMatch(/await\s+analytics\.getDashboard/);
    // exportData should be awaited
    expect(analyticsContent).toMatch(/await\s+analytics\.exportData/);
  });
});

describe('db.js legacy messages path is correct', () => {

  let dbContent;

  beforeAll(() => {
    dbContent = fs.readFileSync(path.join(ROOT, 'database', 'db.js'), 'utf8');
  });

  test('messages path points to project root, not database/', () => {
    // Should use __dirname, '..', 'messages' (goes up from database/ to root)
    expect(dbContent).toMatch(/path\.join\(__dirname,\s*['"]\.\.['"],\s*['"]messages['"]/);
    // Should NOT use __dirname, 'messages' (would look inside database/)
    expect(dbContent).not.toMatch(/path\.join\(__dirname,\s*['"]messages['"]/);
  });
});
