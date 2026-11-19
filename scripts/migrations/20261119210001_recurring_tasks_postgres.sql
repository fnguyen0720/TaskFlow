-- TaskFlow PR #19: additive PostgreSQL migration FIRST, before merging.
-- Execute once against the verified TaskFlow production database, using psql
-- with a secure connection supplied outside GitHub. Never commit credentials.
-- Stop if prerequisite migrations or schema expectations do not match.
BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."__EFMigrationsHistory"
    WHERE "MigrationId" = '20261119164957_AddTaskDetails'
  ) THEN
    RAISE EXCEPTION 'Required AddTaskDetails migration is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Tasks'
      AND column_name IN ('RecurrenceRule', 'ReminderDaysBefore')
  ) THEN
    RAISE EXCEPTION 'New columns already exist; inspect schema and migration history before retrying';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."__EFMigrationsHistory"
    WHERE "MigrationId" = '20261119210001_AddRecurrenceAndRemindersPostgres'
  ) THEN
    RAISE EXCEPTION 'Migration is already recorded';
  END IF;
END
$preflight$;

ALTER TABLE public."Tasks"
  ADD COLUMN "RecurrenceRule" text NOT NULL DEFAULT 'None',
  ADD COLUMN "ReminderDaysBefore" integer NULL;

INSERT INTO public."__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20261119210001_AddRecurrenceAndRemindersPostgres', '10.0.12');

COMMIT;

-- Verify after COMMIT:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Tasks'
  AND column_name IN ('RecurrenceRule', 'ReminderDaysBefore')
ORDER BY column_name;

SELECT "MigrationId", "ProductVersion"
FROM public."__EFMigrationsHistory"
WHERE "MigrationId" = '20261119210001_AddRecurrenceAndRemindersPostgres';
