-- Convert the search_vector column to a real tsvector type
ALTER TABLE projects ALTER COLUMN search_vector TYPE tsvector USING search_vector::tsvector;

-- Create the GIN index for full-text search
CREATE INDEX IF NOT EXISTS projects_search_vector_gin_idx ON projects USING GIN (search_vector);

-- Create the trigger function to update search_vector
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
    )), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the trigger
CREATE TRIGGER projects_search_vector_trigger
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION projects_search_vector_update();
