-- Runs as POSTGRES_USER on first volume init.
-- Needed for drizzle-kit to create its "drizzle" migrations-tracking schema.
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), current_user);
END;
$$;
-- Needed for drizzle migrations to create tables in the public schema.
GRANT CREATE ON SCHEMA public TO CURRENT_USER;
