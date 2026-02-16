-- Add last_build_at column for staleness penalty on popularity score
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_build_at timestamp;
