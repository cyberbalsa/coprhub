-- Sync TTL: job-level tracking table + per-project discourse timestamp
CREATE TABLE IF NOT EXISTS sync_jobs (
  job_name text PRIMARY KEY,
  last_completed_at timestamp NOT NULL,
  duration_ms integer
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_synced_at timestamp;
