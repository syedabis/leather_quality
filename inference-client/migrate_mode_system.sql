-- ============================================================
-- Shape-Triggered Mode System — DB Migration
-- Run once on the client SQL Server database.
-- ============================================================

-- 1. Add session_type column to AppSessions
--    (existing rows automatically get the 'PRODUCTION' default)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.AppSessions')
      AND name = 'session_type'
)
BEGIN
    ALTER TABLE dbo.AppSessions
    ADD session_type VARCHAR(20) NOT NULL
        CONSTRAINT DF_AppSessions_session_type DEFAULT 'PRODUCTION';
    PRINT 'Added session_type column to AppSessions';
END
ELSE
    PRINT 'session_type column already exists — skipped';

-- 2. PlantModes table — current live mode per plant (one row per plant)
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'PlantModes' AND type = 'U')
BEGIN
    CREATE TABLE dbo.PlantModes (
        plant_id     VARCHAR(10) NOT NULL,
        current_mode VARCHAR(20) NOT NULL CONSTRAINT DF_PlantModes_mode DEFAULT 'NORMAL',
        mode_since   DATETIME    NULL,
        session_id   INT         NULL,
        CONSTRAINT PK_PlantModes PRIMARY KEY (plant_id)
    );
    INSERT INTO dbo.PlantModes (plant_id, current_mode) VALUES
        ('SP-01', 'NORMAL'),
        ('SP-02', 'NORMAL'),
        ('SP-03', 'NORMAL'),
        ('SP-04', 'NORMAL'),
        ('SP-05', 'NORMAL'),
        ('SP-06', 'NORMAL');
    PRINT 'Created PlantModes table and seeded 6 plants';
END
ELSE
    PRINT 'PlantModes table already exists — skipped';

-- 3. SystemSettings — mode thresholds (insert only if key not already present)
IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = 'shape_confidence_threshold')
    INSERT INTO dbo.SystemSettings (setting_key, setting_value) VALUES ('shape_confidence_threshold', '0.75');

IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = 'shape_consecutive_hits')
    INSERT INTO dbo.SystemSettings (setting_key, setting_value) VALUES ('shape_consecutive_hits', '3');

IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = 'shape_cooldown_s')
    INSERT INTO dbo.SystemSettings (setting_key, setting_value) VALUES ('shape_cooldown_s', '15');

IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = 'washing_idle_threshold_s')
    INSERT INTO dbo.SystemSettings (setting_key, setting_value) VALUES ('washing_idle_threshold_s', '1200');

IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = 'mode_piece_burst_count')
    INSERT INTO dbo.SystemSettings (setting_key, setting_value) VALUES ('mode_piece_burst_count', '10');

IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = 'mode_piece_burst_window_s')
    INSERT INTO dbo.SystemSettings (setting_key, setting_value) VALUES ('mode_piece_burst_window_s', '35');

PRINT 'SystemSettings rows inserted (skipped any that already existed)';
