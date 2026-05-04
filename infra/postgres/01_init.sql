-- Runs on first startup of the postgres container.
-- Idempotent — safe to keep simple.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
