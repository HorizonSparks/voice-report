-- Web Push Subscriptions
-- Stores the per-device PushSubscription objects returned by the browser's
-- PushManager. One person can have many active subscriptions (work tablet,
-- phone, office desktop) — we push to all of them and prune any that the
-- push provider reports as gone (HTTP 410).
--
-- Safe to re-run: every step is idempotent.

SET search_path TO voicereport;

CREATE TABLE IF NOT EXISTS voicereport.push_subscriptions (
  id            SERIAL PRIMARY KEY,
  person_id     TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);

-- Endpoint is the canonical unique identifier for a subscription — the
-- browser hands the same URL back on resubscribe. Unique constraint
-- means we can upsert without dedup logic in app code.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_push_subscriptions_endpoint
  ON voicereport.push_subscriptions(endpoint);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_person
  ON voicereport.push_subscriptions(person_id);
