-- Discourse comments cache table
CREATE TABLE IF NOT EXISTS discourse_cache (
  project_id integer PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  fetched_at timestamp NOT NULL DEFAULT NOW()
);
