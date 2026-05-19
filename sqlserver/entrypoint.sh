#!/bin/bash
# Custom entrypoint for the spray-plant SQL Server image.
#
# Boot order:
#   1. Launch the real sqlservr in the background.
#   2. Wait until it accepts logins.
#   3. Apply init.sql (idempotent: every CREATE is `IF NOT EXISTS` guarded).
#   4. Block on the sqlservr process so the container stays alive.
#
# DB_NAME and MSSQL_SA_PASSWORD come from the container env (set by
# docker-compose from the .env file at the project root).

set -e

DB_NAME="${DB_NAME:-LeatherCount}"
SQLCMD=/opt/mssql-tools18/bin/sqlcmd
INIT_SQL=/opt/spray-init/init.sql

echo "[spray-init] Starting SQL Server (sqlservr) in the background..."
/opt/mssql/bin/sqlservr &
SQL_PID=$!

echo "[spray-init] Waiting for SQL Server to accept connections..."
for i in {1..60}; do
    if "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -No -Q "SELECT 1" >/dev/null 2>&1; then
        echo "[spray-init] SQL Server is ready (after ${i}x2s)."
        break
    fi
    if ! kill -0 "$SQL_PID" 2>/dev/null; then
        echo "[spray-init] sqlservr exited before becoming ready. Aborting."
        exit 1
    fi
    sleep 2
done

if ! "$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -No -Q "SELECT 1" >/dev/null 2>&1; then
    echo "[spray-init] Timed out waiting for SQL Server. Aborting."
    exit 1
fi

echo "[spray-init] Applying init.sql with DB_NAME='${DB_NAME}'..."
"$SQLCMD" -S localhost -U sa -P "$MSSQL_SA_PASSWORD" \
    -d master -No -b \
    -v DB_NAME="$DB_NAME" \
    -i "$INIT_SQL"

echo "[spray-init] Database initialisation complete. Handing off to sqlservr."
wait $SQL_PID
