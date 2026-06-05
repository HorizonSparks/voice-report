/**
 * Hermes Bridge client — recall app-internal institutional memory from the Spark Hermes over the
 * tailnet (the brain + memory live on the Spark; this app calls it).
 *
 * FAIL-OPEN BY DESIGN: any missing config, timeout, network blip, or non-200 returns [] / '' so the
 * customer-facing app NEVER breaks if the Spark is asleep, the tailnet hiccups, or the bridge is down.
 * Configured purely via env (no secrets in code):
 *   HERMES_BRIDGE_URL    e.g. http://100.64.10.20:9787   (unset = disabled, returns [])
 *   HERMES_BRIDGE_TOKEN  bearer token (matches ~/.hermes/bridge_token on the Spark)
 *   HERMES_BRIDGE_TIMEOUT_MS  default 2000
 */
const BRIDGE_URL = (process.env.HERMES_BRIDGE_URL || '').replace(/\/+$/, '');
const BRIDGE_TOKEN = process.env.HERMES_BRIDGE_TOKEN || '';
const TIMEOUT_MS = parseInt(process.env.HERMES_BRIDGE_TIMEOUT_MS || '2000', 10);

function bridgeEnabled() {
  return Boolean(BRIDGE_URL && BRIDGE_TOKEN);
}

/**
 * Recall up to `limit` institutional-memory facts relevant to `query`.
 * @returns {Promise<Array<{content,category,tags,trust}>>} — always an array; [] on any failure.
 */
async function recallFromBridge(query, limit = 4) {
  if (!bridgeEnabled() || !query || typeof fetch !== 'function') return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BRIDGE_URL}/recall`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: String(query).slice(0, 500), limit: Math.min(limit, 8) }),
      signal: controller.signal,
    });
    if (!r.ok) return [];
    const data = await r.json().catch(() => ({}));
    return Array.isArray(data.results) ? data.results : [];
  } catch (_e) {
    return []; // fail-open
  } finally {
    clearTimeout(timer);
  }
}

/** Format recalled facts as a prompt block. '' when there's nothing (so it injects cleanly). */
function formatBridgeMemory(results) {
  if (!Array.isArray(results) || results.length === 0) return '';
  const lines = results
    .map((r) => `- ${String((r && r.content) || '').slice(0, 400)}`)
    .filter((l) => l.length > 2)
    .join('\n');
  if (!lines) return '';
  return `\nINSTITUTIONAL MEMORY (from the Hermes brain — how Horizon Sparks / this product works):\n${lines}\n`;
}

module.exports = { recallFromBridge, formatBridgeMemory, bridgeEnabled };
