"""
Database schema initialization and migration.
Creates all tables, indexes, and stored procedures for the hybrid caching strategy.
"""

import sys
import io

# Fix encoding for Windows console
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from app.db.connection import get_connection


def create_current_hour_metrics_table():
    """Create CurrentHourMetrics table for real-time hourly aggregation."""
    sql = """
    IF OBJECT_ID('dbo.CurrentHourMetrics', 'U') IS NULL
    CREATE TABLE dbo.CurrentHourMetrics (
        id INT PRIMARY KEY IDENTITY(1,1),
        source_note VARCHAR(10) NOT NULL,
        hour_start DATETIME2 NOT NULL,

        -- Running aggregates (updated frequently)
        frame_count INT DEFAULT 0,
        piece_count INT DEFAULT 0,
        uptime_frames INT DEFAULT 0,
        downtime_frames INT DEFAULT 0,

        -- Idle tracking
        idle_sessions_count INT DEFAULT 0,
        idle_time_s FLOAT DEFAULT 0,

        -- Utilization
        sum_utilization FLOAT DEFAULT 0,

        -- Metadata
        last_updated DATETIME2 DEFAULT GETDATE(),
        last_belt_active BIT DEFAULT 0,

        UNIQUE (source_note, hour_start)
    );
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()


def create_hourly_metrics_table():
    """Create HourlyMetrics table for completed hours (immutable)."""
    sql = """
    IF OBJECT_ID('dbo.HourlyMetrics', 'U') IS NULL
    CREATE TABLE dbo.HourlyMetrics (
        id INT PRIMARY KEY IDENTITY(1,1),
        source_note VARCHAR(10) NOT NULL,
        hour_start DATETIME2 NOT NULL,
        hour_end DATETIME2 NOT NULL,

        piece_count INT,
        uptime_pct FLOAT,
        downtime_pct FLOAT,
        idle_sessions_count INT,
        idle_time_s INT,
        idle_time_avg_s FLOAT,
        idle_time_peak_s INT,
        avg_utilization_pct FLOAT,

        created_at DATETIME2 DEFAULT GETDATE(),

        UNIQUE (source_note, hour_start),
        INDEX idx_source_hour (source_note, hour_start)
    );
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()


def create_daily_metrics_table():
    """Create DailyMetrics table for daily aggregates (optional, for reports)."""
    sql = """
    IF OBJECT_ID('dbo.DailyMetrics', 'U') IS NULL
    CREATE TABLE dbo.DailyMetrics (
        id INT PRIMARY KEY IDENTITY(1,1),
        source_note VARCHAR(10) NOT NULL,
        date DATE NOT NULL,

        piece_count INT,
        uptime_pct FLOAT,
        downtime_pct FLOAT,
        idle_sessions_count INT,
        idle_time_s INT,
        avg_utilization_pct FLOAT,

        created_at DATETIME2 DEFAULT GETDATE(),

        UNIQUE (source_note, date),
        INDEX idx_source_date (source_note, date)
    );
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()


def create_covering_index():
    """Create covering index on LeatherCountLog for fast aggregation queries."""
    sql = """
    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'idx_source_saved_belt'
        AND object_id = OBJECT_ID('dbo.LeatherCountLog')
    )
    CREATE INDEX idx_source_saved_belt
        ON dbo.LeatherCountLog (source_note, saved_at, belt_active)
        INCLUDE (total_count, utilization_pct);
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()


def create_sp_analytics_by_hour():
    """Stored procedure: hourly analytics from HourlyMetrics + CurrentHourMetrics."""
    # CREATE OR ALTER preserves existing EXECUTE grants (avoids DROP which wipes permissions)
    sql = """
    CREATE OR ALTER PROCEDURE sp_analytics_by_hour
        @unit VARCHAR(10),
        @date DATE
    AS
    BEGIN
        -- Completed hours from HourlyMetrics
        SELECT
            DATEPART(HOUR, hour_start) AS hour,
            ISNULL(piece_count, 0) AS pieces,
            ISNULL(uptime_pct, 0) AS uptime_pct,
            ISNULL(downtime_pct, 0) AS downtime_pct,
            ISNULL(idle_sessions_count, 0) AS idle_sessions,
            ISNULL(idle_time_s, 0) AS idle_time_s,
            ISNULL(avg_utilization_pct, 0) AS avg_utilization_pct
        FROM dbo.HourlyMetrics
        WHERE source_note = @unit
          AND CAST(hour_start AS DATE) = @date

        UNION ALL

        -- Current partial hour from CurrentHourMetrics
        SELECT
            DATEPART(HOUR, hour_start) AS hour,
            piece_count AS pieces,
            CAST(CASE
                WHEN frame_count = 0 THEN 0
                ELSE (uptime_frames * 100.0 / frame_count)
            END AS DECIMAL(5,1)) AS uptime_pct,
            CAST(CASE
                WHEN frame_count = 0 THEN 0
                ELSE 100 - (uptime_frames * 100.0 / frame_count)
            END AS DECIMAL(5,1)) AS downtime_pct,
            idle_sessions_count AS idle_sessions,
            idle_time_s AS idle_time_s,
            CAST(CASE
                WHEN frame_count = 0 THEN 0
                ELSE (sum_utilization / frame_count)
            END AS DECIMAL(5,1)) AS avg_utilization_pct
        FROM dbo.CurrentHourMetrics
        WHERE source_note = @unit
          AND CAST(hour_start AS DATE) = @date

        ORDER BY hour;
    END;
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()


def create_sp_analytics_by_day():
    """Stored procedure: daily analytics from HourlyMetrics + CurrentHourMetrics."""
    # CREATE OR ALTER preserves existing EXECUTE grants (avoids DROP which wipes permissions)
    # Combines completed hours (HourlyMetrics) with the in-progress current hour
    # (CurrentHourMetrics) so today shows up before the hourly rollup runs.
    sql = """
    CREATE OR ALTER PROCEDURE sp_analytics_by_day
        @unit VARCHAR(10) = NULL,
        @from_date VARCHAR(10) = NULL,
        @to_date VARCHAR(10) = NULL
    AS
    BEGIN
        DECLARE @from_dt DATE = ISNULL(TRY_CAST(@from_date AS DATE), DATEADD(DAY, -7, CAST(GETDATE() AS DATE)));
        DECLARE @to_dt DATE = ISNULL(TRY_CAST(@to_date AS DATE), CAST(GETDATE() AS DATE));

        ;WITH combined AS (
            SELECT
                CAST(hour_start AS DATE)  AS date,
                source_note               AS unit,
                ISNULL(piece_count, 0)    AS pieces,
                ISNULL(uptime_pct, 0)     AS uptime_pct,
                ISNULL(downtime_pct, 0)   AS downtime_pct,
                ISNULL(idle_sessions_count, 0) AS idle_sessions,
                ISNULL(idle_time_s, 0)    AS idle_time_s,
                ISNULL(avg_utilization_pct, 0) AS avg_utilization_pct
            FROM dbo.HourlyMetrics
            WHERE (@unit IS NULL OR source_note = @unit)
              AND CAST(hour_start AS DATE) >= @from_dt
              AND CAST(hour_start AS DATE) <= @to_dt

            UNION ALL

            SELECT
                CAST(hour_start AS DATE) AS date,
                source_note              AS unit,
                ISNULL(piece_count, 0)   AS pieces,
                CAST(CASE WHEN frame_count = 0 THEN 0
                          ELSE (uptime_frames * 100.0 / frame_count) END
                     AS DECIMAL(5,1))    AS uptime_pct,
                CAST(CASE WHEN frame_count = 0 THEN 0
                          ELSE 100 - (uptime_frames * 100.0 / frame_count) END
                     AS DECIMAL(5,1))    AS downtime_pct,
                ISNULL(idle_sessions_count, 0) AS idle_sessions,
                ISNULL(idle_time_s, 0)   AS idle_time_s,
                CAST(CASE WHEN frame_count = 0 THEN 0
                          ELSE (sum_utilization / frame_count) END
                     AS DECIMAL(5,1))    AS avg_utilization_pct
            FROM dbo.CurrentHourMetrics
            WHERE (@unit IS NULL OR source_note = @unit)
              AND CAST(hour_start AS DATE) >= @from_dt
              AND CAST(hour_start AS DATE) <= @to_dt
        )
        SELECT
            date,
            unit,
            SUM(pieces)                           AS pieces,
            CAST(AVG(uptime_pct)   AS DECIMAL(5,1)) AS uptime_pct,
            CAST(AVG(downtime_pct) AS DECIMAL(5,1)) AS downtime_pct,
            SUM(idle_sessions)                    AS idle_sessions,
            SUM(idle_time_s)                      AS idle_time_s,
            CAST(AVG(avg_utilization_pct) AS DECIMAL(5,1)) AS avg_utilization_pct
        FROM combined
        GROUP BY date, unit
        ORDER BY date, unit;
    END;
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()


def create_sp_analytics_by_shift():
    """Stored procedure: shift analytics (Morning 06-14, Afternoon 14-22, Night 22-06)."""
    # CREATE OR ALTER preserves existing EXECUTE grants (avoids DROP which wipes permissions)
    sql = """
    CREATE OR ALTER PROCEDURE sp_analytics_by_shift
        @unit VARCHAR(10) = NULL,
        @from_date VARCHAR(10) = NULL,
        @to_date VARCHAR(10) = NULL
    AS
    BEGIN
        DECLARE @from_dt DATE = ISNULL(TRY_CAST(@from_date AS DATE), DATEADD(DAY, -7, CAST(GETDATE() AS DATE)));
        DECLARE @to_dt DATE = ISNULL(TRY_CAST(@to_date AS DATE), CAST(GETDATE() AS DATE));

        SELECT
            CAST(hour_start AS DATE) AS date,
            source_note AS unit,
            CASE
                WHEN DATEPART(HOUR, hour_start) >= 6 AND DATEPART(HOUR, hour_start) < 14 THEN 'Morning'
                WHEN DATEPART(HOUR, hour_start) >= 14 AND DATEPART(HOUR, hour_start) < 22 THEN 'Afternoon'
                ELSE 'Night'
            END AS shift,
            SUM(ISNULL(piece_count, 0)) AS pieces,
            CAST(AVG(ISNULL(uptime_pct, 0)) AS DECIMAL(5,1)) AS uptime_pct
        FROM dbo.HourlyMetrics
        WHERE (@unit IS NULL OR source_note = @unit)
          AND CAST(hour_start AS DATE) >= @from_dt
          AND CAST(hour_start AS DATE) <= @to_dt
        GROUP BY CAST(hour_start AS DATE), source_note,
                 CASE
                    WHEN DATEPART(HOUR, hour_start) >= 6 AND DATEPART(HOUR, hour_start) < 14 THEN 'Morning'
                    WHEN DATEPART(HOUR, hour_start) >= 14 AND DATEPART(HOUR, hour_start) < 22 THEN 'Afternoon'
                    ELSE 'Night'
                 END
        ORDER BY date, unit, shift;
    END;
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()


def migrate_add_last_belt_active():
    """Add last_belt_active column to CurrentHourMetrics if missing."""
    sql = """
    IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.CurrentHourMetrics') AND name = 'last_belt_active'
    )
    ALTER TABLE dbo.CurrentHourMetrics ADD last_belt_active BIT DEFAULT 0;
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()


def create_settings_table():
    """Create SystemSettings table and seed defaults."""
    sql = """
    IF OBJECT_ID('dbo.SystemSettings', 'U') IS NULL
    CREATE TABLE dbo.SystemSettings (
        key VARCHAR(50) PRIMARY KEY,
        value VARCHAR(255) NOT NULL,
        updated_at DATETIME2 DEFAULT GETDATE()
    );
    """
    seed_sql = """
    IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE key = 'idle_timeout_sec')
        INSERT INTO dbo.SystemSettings (key, value) VALUES ('idle_timeout_sec', '30');
    IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE key = 'downtime_threshold_sec')
        INSERT INTO dbo.SystemSettings (key, value) VALUES ('downtime_threshold_sec', '300');
    """
    with get_connection() as conn:
        conn.execute(sql)
        conn.commit()
        conn.execute(seed_sql)
        conn.commit()


def _schema_exists() -> bool:
    """Returns True if the core tables already exist in the database."""
    sql = """
    SELECT COUNT(*) FROM sys.tables
    WHERE name IN ('CurrentHourMetrics', 'HourlyMetrics', 'DailyMetrics')
    """
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql)
        return (cur.fetchone()[0] or 0) == 3


def initialize_schema():
    """
    On a fresh DB: create all tables, indexes, and stored procedures.
    On an existing DB: only refresh stored procedures (preserves all data).
    """
    try:
        if _schema_exists():
            print("Schema already exists — refreshing stored procedures only...")
            create_sp_analytics_by_hour()
            create_sp_analytics_by_day()
            create_sp_analytics_by_shift()
            create_settings_table()
            migrate_add_last_belt_active()
            print("✅ Stored procedures refreshed.")
            return

        print("Fresh database detected — running full schema initialization...")
        create_current_hour_metrics_table()
        create_hourly_metrics_table()
        create_daily_metrics_table()
        create_covering_index()
        create_sp_analytics_by_hour()
        create_sp_analytics_by_day()
        create_sp_analytics_by_shift()
        create_settings_table()
        print("✅ Schema initialization complete!")
    except Exception as e:
        print(f"❌ Schema initialization failed: {e}")
        raise


if __name__ == "__main__":
    initialize_schema()
