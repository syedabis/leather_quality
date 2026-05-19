-- Idempotent schema bootstrap for the spray-plant database.
-- Re-running this script is safe: every CREATE is guarded by IF NOT EXISTS.
-- The database name comes from the DB_NAME variable passed by docker-compose.

SET NOCOUNT ON;

IF DB_ID(N'$(DB_NAME)') IS NULL
BEGIN
    DECLARE @sql nvarchar(max) = N'CREATE DATABASE [' + N'$(DB_NAME)' + N']';
    EXEC sp_executesql @sql;
    PRINT 'Created database $(DB_NAME)';
END
ELSE
    PRINT 'Database $(DB_NAME) already exists - skipping create';
GO

-- SQL Server Express defaults to AUTO_CLOSE ON which shuts the DB down after
-- every connection closes and restarts it on the next one. Disable it.
DECLARE @ac nvarchar(max) = N'ALTER DATABASE [' + N'$(DB_NAME)' + N'] SET AUTO_CLOSE OFF';
EXEC sp_executesql @ac;
GO

USE [$(DB_NAME)];
GO

IF OBJECT_ID(N'dbo.CurrentHourMetrics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CurrentHourMetrics (
        id                  INT IDENTITY(1,1) NOT NULL,
        source_note         VARCHAR(10)       NOT NULL,
        hour_start          DATETIME2(7)      NOT NULL,
        frame_count         INT               NULL CONSTRAINT DF_CurrentHourMetrics_frame_count         DEFAULT (0),
        piece_count         INT               NULL CONSTRAINT DF_CurrentHourMetrics_piece_count         DEFAULT (0),
        uptime_frames       INT               NULL CONSTRAINT DF_CurrentHourMetrics_uptime_frames       DEFAULT (0),
        downtime_frames     INT               NULL CONSTRAINT DF_CurrentHourMetrics_downtime_frames     DEFAULT (0),
        idle_sessions_count INT               NULL CONSTRAINT DF_CurrentHourMetrics_idle_sessions_count DEFAULT (0),
        idle_time_s         FLOAT             NULL CONSTRAINT DF_CurrentHourMetrics_idle_time_s         DEFAULT (0),
        sum_utilization     FLOAT             NULL CONSTRAINT DF_CurrentHourMetrics_sum_utilization     DEFAULT (0),
        last_updated        DATETIME2(7)      NULL CONSTRAINT DF_CurrentHourMetrics_last_updated        DEFAULT (GETDATE()),
        CONSTRAINT PK_CurrentHourMetrics            PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_CurrentHourMetrics_source_hr  UNIQUE (source_note, hour_start)
    );
    PRINT 'Created table dbo.CurrentHourMetrics';
END;
GO

IF OBJECT_ID(N'dbo.HourlyMetrics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.HourlyMetrics (
        id                  INT IDENTITY(1,1) NOT NULL,
        source_note         VARCHAR(10)       NOT NULL,
        hour_start          DATETIME2(7)      NOT NULL,
        hour_end            DATETIME2(7)      NOT NULL,
        piece_count         INT               NULL,
        uptime_pct          FLOAT             NULL,
        downtime_pct        FLOAT             NULL,
        idle_sessions_count INT               NULL,
        idle_time_s         INT               NULL,
        idle_time_avg_s     FLOAT             NULL,
        idle_time_peak_s    INT               NULL,
        avg_utilization_pct FLOAT             NULL,
        created_at          DATETIME2(7)      NULL CONSTRAINT DF_HourlyMetrics_created_at DEFAULT (GETDATE()),
        CONSTRAINT PK_HourlyMetrics           PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_HourlyMetrics_source_hr UNIQUE (source_note, hour_start)
    );
    CREATE NONCLUSTERED INDEX idx_source_hour ON dbo.HourlyMetrics (source_note, hour_start);
    PRINT 'Created table dbo.HourlyMetrics';
END;
GO

IF OBJECT_ID(N'dbo.DailyMetrics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DailyMetrics (
        id                  INT IDENTITY(1,1) NOT NULL,
        source_note         VARCHAR(10)       NOT NULL,
        [date]              DATE              NOT NULL,
        piece_count         INT               NULL,
        uptime_pct          FLOAT             NULL,
        downtime_pct        FLOAT             NULL,
        idle_sessions_count INT               NULL,
        idle_time_s         INT               NULL,
        avg_utilization_pct FLOAT             NULL,
        created_at          DATETIME2(7)      NULL CONSTRAINT DF_DailyMetrics_created_at DEFAULT (GETDATE()),
        CONSTRAINT PK_DailyMetrics             PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_DailyMetrics_source_date UNIQUE (source_note, [date])
    );
    CREATE NONCLUSTERED INDEX idx_source_date ON dbo.DailyMetrics (source_note, [date]);
    PRINT 'Created table dbo.DailyMetrics';
END;
GO

PRINT 'init.sql finished';
GO
