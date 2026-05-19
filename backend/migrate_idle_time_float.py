"""
One-shot migration: convert dbo.CurrentHourMetrics.idle_time_s from INT to FLOAT.

Why: live frame_time_delta values (~0.05–0.25s) truncate to 0 when added to an
INT column, so idle_time_s never advances past 0 even though downtime_frames
and idle_sessions_count both increment. Run this once.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from app.db.connection import get_connection


def migrate():
    drop_default = """
    DECLARE @cname sysname = (
        SELECT dc.name
        FROM sys.default_constraints dc
        JOIN sys.columns c
          ON c.default_object_id = dc.object_id
        WHERE c.object_id = OBJECT_ID('dbo.CurrentHourMetrics')
          AND c.name = 'idle_time_s'
    );
    IF @cname IS NOT NULL
        EXEC('ALTER TABLE dbo.CurrentHourMetrics DROP CONSTRAINT ' + @cname);
    """
    alter_column = """
    IF EXISTS (
        SELECT 1
        FROM sys.columns c
        JOIN sys.types t ON c.user_type_id = t.user_type_id
        WHERE c.object_id = OBJECT_ID('dbo.CurrentHourMetrics')
          AND c.name = 'idle_time_s'
          AND t.name <> 'float'
    )
    ALTER TABLE dbo.CurrentHourMetrics ALTER COLUMN idle_time_s FLOAT;
    """
    add_default = """
    IF NOT EXISTS (
        SELECT 1
        FROM sys.default_constraints dc
        JOIN sys.columns c
          ON c.default_object_id = dc.object_id
        WHERE c.object_id = OBJECT_ID('dbo.CurrentHourMetrics')
          AND c.name = 'idle_time_s'
    )
    ALTER TABLE dbo.CurrentHourMetrics
        ADD CONSTRAINT DF_CurrentHourMetrics_idle_time_s
        DEFAULT 0 FOR idle_time_s;
    """
    with get_connection() as conn:
        conn.execute(drop_default)
        conn.execute(alter_column)
        conn.execute(add_default)
        conn.commit()
    print("OK — CurrentHourMetrics.idle_time_s is now FLOAT (default 0).")


if __name__ == "__main__":
    migrate()
