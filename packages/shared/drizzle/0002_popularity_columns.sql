-- Add new columns for votes, downloads, discourse, readme, and popularity
ALTER TABLE projects ADD COLUMN IF NOT EXISTS copr_votes integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS copr_downloads integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS copr_repo_enables integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_topic_id integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_likes integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_views integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS discourse_replies integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS upstream_readme text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS popularity_score integer DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS readme_synced_at timestamp;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS votes_synced_at timestamp;

-- Index for sorting by popularity
CREATE INDEX IF NOT EXISTS projects_popularity_score_idx ON projects (popularity_score);

-- Update the search vector trigger to include README content
CREATE OR REPLACE FUNCTION projects_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.owner, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.upstream_description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.upstream_language, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(t, ' ') FROM jsonb_array_elements_text(coalesce(NEW.upstream_topics, '[]'::jsonb)) AS t),
      ''
    )), 'D') ||
    setweight(to_tsvector('english', coalesce(NEW.upstream_readme, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
