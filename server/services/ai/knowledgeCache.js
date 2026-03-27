/**
 * Knowledge Cache
 * In-memory cache for knowledge JSON files.
 * Preloads on first access, avoids repeated fs.readFileSync during requests.
 */

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, '../../../knowledge');
const cache = new Map();
let initialized = false;

/**
 * Load all knowledge files into memory
 */
function initialize() {
  if (initialized) return;

  try {
    if (!fs.existsSync(KNOWLEDGE_DIR)) {
      console.log('Knowledge directory not found, cache empty');
      initialized = true;
      return;
    }

    const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const filePath = path.join(KNOWLEDGE_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const key = file.replace('.json', '');
        cache.set(key, data);
      } catch (err) {
        console.warn(`Failed to load knowledge file ${file}:`, err.message);
      }
    }

    console.log(`Knowledge cache loaded: ${cache.size} files`);
    initialized = true;
  } catch (err) {
    console.error('Knowledge cache initialization error:', err.message);
    initialized = true; // Don't retry on error
  }
}

/**
 * Get a knowledge file from cache
 * @param {string} key - File name without extension (e.g., 'electrical_safety')
 * @returns {object|null}
 */
function get(key) {
  if (!initialized) initialize();
  return cache.get(key) || null;
}

/**
 * Get all cached knowledge keys
 * @returns {string[]}
 */
function keys() {
  if (!initialized) initialize();
  return Array.from(cache.keys());
}

/**
 * Check if a key exists in cache
 */
function has(key) {
  if (!initialized) initialize();
  return cache.has(key);
}

/**
 * Get cache stats
 */
function stats() {
  return { size: cache.size, initialized, keys: Array.from(cache.keys()) };
}

module.exports = { initialize, get, has, keys, stats };
