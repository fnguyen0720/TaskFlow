#!/usr/bin/env bash
# PR #50: Destructive operations are restricted to a fixed, disposable CI DB.
# This script intentionally rejects arbitrary connection strings, remote hosts,
# production database names, and caller-provided restoration targets.
set -euo pipefail

EXPECTED="Host=127.0.0.1;Port=5432;Database=taskflow_integration;Username=taskflow_test;Password=disposable_ci_password;Pooling=false"
if [[ "${TASKFLOW_RECOVERY_TEST:-}" != "1" || "${TASKFLOW_INTEGRATION_POSTGRES:-}" != "$EXPECTED" ]]; then
  echo "REFUSED: recovery rehearsal requires the exact disposable localhost CI database." >&2
  exit 2
fi
command -v docker >/dev/null || { echo "Docker is required" >&2; exit 2; }
command -v mktemp >/dev/null || { echo "mktemp is required" >&2; exit 2; }

SOURCE_DB=taskflow_integration
RESTORED_DB=taskflow_restore_verify
HOST=127.0.0.1
PGUSER=taskflow_test
PGPASSWORD=disposable_ci_password
WORKDIR="$(mktemp -d)"
CREATED=0

# All PostgreSQL commands run in the same pinned PostgreSQL 18 client container.
# Never interpolate connection strings or database names from user input.
pg() {
  docker run --rm --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    -v "$WORKDIR:/recovery" \
    postgres:18 "$@"
}
cleanup() {
  if [[ "$CREATED" == "1" ]]; then
    pg dropdb --if-exists -h "$HOST" -U "$PGUSER" "$RESTORED_DB" >/dev/null || true
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# An unexpected existing target is not ours to destroy.
if pg psql -h "$HOST" -U "$PGUSER" -d "$SOURCE_DB" -Atqc \
  "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname='taskflow_restore_verify')" | grep -qx t; then
  echo "REFUSED: disposable restore target already exists." >&2
  exit 2
fi

pg psql -h "$HOST" -U "$PGUSER" -d "$SOURCE_DB" -v ON_ERROR_STOP=1 -Atqc \
  'SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM "Tasks"' | grep -qx 1 || {
    echo "REFUSED: source database lacks synthetic task fixtures." >&2; exit 2;
  }
pg psql -h "$HOST" -U "$PGUSER" -d "$SOURCE_DB" -v ON_ERROR_STOP=1 -Atqc \
  'SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM "TaskVersions"' | grep -qx 1 || {
    echo "REFUSED: source database lacks synthetic version fixtures." >&2; exit 2;
  }

# A non-plain custom-format dump is easier to verify and limits operator error.
# The contents are never uploaded as a GitHub artifact or printed in CI logs.
pg pg_dump -h "$HOST" -U "$PGUSER" -d "$SOURCE_DB" \
  --format=custom --no-owner --no-acl --file=/recovery/snapshot.dump
test -s "$WORKDIR/snapshot.dump"

pg createdb -h "$HOST" -U "$PGUSER" "$RESTORED_DB"
CREATED=1
pg pg_restore -h "$HOST" -U "$PGUSER" -d "$RESTORED_DB" \
  --no-owner --no-acl --exit-on-error /recovery/snapshot.dump

# Compare a stable sorted representation of all user/task/migration tables.
# Only opaque hashes are compared in memory; no user-entered fields are logged.
SQL=$(cat <<'SQL'
SELECT string_agg(
  label || ':' || row_count::text || ':' || fingerprint, E'\n'
  ORDER BY label)
FROM (
  SELECT 'users' AS label, COUNT(*) AS row_count,
    md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t."Id"), '')) AS fingerprint FROM "AspNetUsers" t
  UNION ALL SELECT 'tasks', COUNT(*),
    md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t."Id"), '')) FROM "Tasks" t
  UNION ALL SELECT 'versions', COUNT(*),
    md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t."Id"), '')) FROM "TaskVersions" t
  UNION ALL SELECT 'activity', COUNT(*),
    md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t."Id"), '')) FROM "TaskActivities" t
  UNION ALL SELECT 'notification-state', COUNT(*),
    md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t."UserId", t."TaskId", t."Kind"), '')) FROM "TaskNotificationStates" t
  UNION ALL SELECT 'notification-prefs', COUNT(*),
    md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t."UserId"), '')) FROM "NotificationPreferences" t
  UNION ALL SELECT 'migrations', COUNT(*),
    md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t."MigrationId"), '')) FROM "__EFMigrationsHistory" t
) checks;
SQL
)
SOURCE_SIGNATURE="$(pg psql -h "$HOST" -U "$PGUSER" -d "$SOURCE_DB" -v ON_ERROR_STOP=1 -Atqc "$SQL")"
RESTORED_SIGNATURE="$(pg psql -h "$HOST" -U "$PGUSER" -d "$RESTORED_DB" -v ON_ERROR_STOP=1 -Atqc "$SQL")"
if [[ -z "$SOURCE_SIGNATURE" || "$SOURCE_SIGNATURE" != "$RESTORED_SIGNATURE" ]]; then
  echo "FAIL: restored schema/content fingerprints do not match disposable source." >&2
  exit 1
fi

# Ensure owner-based foreign keys and the history index survived restoration.
pg psql -h "$HOST" -U "$PGUSER" -d "$RESTORED_DB" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='IX_TaskVersions_UserId_TaskId_Id')" | grep -qx t
pg psql -h "$HOST" -U "$PGUSER" -d "$RESTORED_DB" -v ON_ERROR_STOP=1 -Atqc \
  'SELECT (SELECT COUNT(*) FROM "TaskVersions" v LEFT JOIN "AspNetUsers" u ON v."UserId"=u."Id" WHERE u."Id" IS NULL) = 0' | grep -qx t

echo "PASS: disposable PostgreSQL 18 dump/restore verified for seven table families, migrations, owner integrity, and task history index."
