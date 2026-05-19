"""
Frame processor: Updates CurrentHourMetrics in real-time as frames arrive.
Implements the hybrid caching strategy for sub-10ms query response times.
"""

import time
from datetime import datetime
from typing import Optional
from app.db.connection import get_connection

_DEADLOCK_RETRIES = 4
_DEADLOCK_DELAY   = 0.05  # seconds between retries


class FrameProcessor:
    """Updates CurrentHourMetrics table on every frame arrival."""

    @staticmethod
    def process_frame(
        source_note: str,
        total_count: int,
        belt_active: bool,
        utilization_pct: float,
        piece_delta: int = 0,
        frame_time_delta_s: float = 0.033,
        idle_sessions_delta: int = 0,
    ) -> bool:
        """
        Process an incoming frame and update CurrentHourMetrics.

        Args:
            source_note: Plant ID (SP3, SP4, ..., SP8)
            total_count: Cumulative piece count
            belt_active: 1 if running, 0 if idle
            utilization_pct: Utilization percentage (0-100)
            piece_delta: Change in piece count since last frame (default 0)
            frame_time_delta_s: Time since last frame in seconds (default 0.033 = 30fps)
            idle_sessions_delta: Increment for idle_sessions_count when idle starts (default 0)

        Returns:
            True if successful, False if failed
        """
        now        = datetime.now()
        hour_start = now.replace(minute=0, second=0, microsecond=0)
        params_update = (
            piece_delta,
            1 if belt_active else 0,
            0 if belt_active else 1,
            utilization_pct,
            frame_time_delta_s if not belt_active else 0,
            idle_sessions_delta,
            source_note,
            hour_start,
        )

        for attempt in range(_DEADLOCK_RETRIES):
            try:
                with get_connection() as conn:
                    cur = conn.cursor()
                    cur.execute(
                        """
                        IF NOT EXISTS (
                            SELECT 1 FROM dbo.CurrentHourMetrics
                            WHERE source_note = ? AND hour_start = ?
                        )
                        INSERT INTO dbo.CurrentHourMetrics (source_note, hour_start)
                        VALUES (?, ?)
                        """,
                        (source_note, hour_start, source_note, hour_start),
                    )
                    cur.execute(
                        """
                        UPDATE dbo.CurrentHourMetrics
                        SET
                            frame_count         = frame_count + 1,
                            piece_count         = piece_count + ?,
                            uptime_frames       = uptime_frames + ?,
                            downtime_frames     = downtime_frames + ?,
                            sum_utilization     = sum_utilization + ?,
                            idle_time_s         = idle_time_s + ?,
                            idle_sessions_count = idle_sessions_count + ?,
                            last_updated        = GETDATE()
                        WHERE source_note = ? AND hour_start = ?
                        """,
                        params_update,
                    )
                    conn.commit()
                    return True

            except Exception as e:
                if getattr(e, 'args', None) and e.args[0] == '40001':
                    if attempt < _DEADLOCK_RETRIES - 1:
                        time.sleep(_DEADLOCK_DELAY * (attempt + 1))
                        continue
                print(f"❌ DB write error: {e}")
                return False

        return False

    @staticmethod
    def finalize_hour(
        source_note: str,
        hour_start: datetime,
    ) -> bool:
        """
        Finalize a completed hour: move from CurrentHourMetrics to HourlyMetrics.
        Called by hourly batch job at :05 each hour.

        Args:
            source_note: Plant ID
            hour_start: Start of the hour to finalize

        Returns:
            True if successful, False if failed
        """
        try:
            with get_connection() as conn:
                cur = conn.cursor()

                # Get current hour metrics
                cur.execute(
                    """
                    SELECT
                        frame_count,
                        piece_count,
                        uptime_frames,
                        idle_sessions_count,
                        idle_time_s,
                        sum_utilization
                    FROM dbo.CurrentHourMetrics
                    WHERE source_note = ? AND hour_start = ?
                    """,
                    (source_note, hour_start)
                )

                row = cur.fetchone()
                if not row:
                    return False

                frame_count, piece_count, uptime_frames, idle_sessions, idle_time_s, sum_util = row

                # Calculate percentages
                uptime_pct = (uptime_frames * 100.0 / max(frame_count, 1)) if frame_count > 0 else 0
                downtime_pct = 100 - uptime_pct
                avg_util = (sum_util / max(frame_count, 1)) if frame_count > 0 else 0

                # Insert into HourlyMetrics
                hour_end = hour_start.replace(hour=hour_start.hour + 1) if hour_start.hour < 23 else hour_start.replace(hour=0, day=hour_start.day + 1)

                cur.execute(
                    """
                    IF NOT EXISTS (
                        SELECT 1 FROM dbo.HourlyMetrics
                        WHERE source_note = ? AND hour_start = ?
                    )
                    INSERT INTO dbo.HourlyMetrics (
                        source_note, hour_start, hour_end, piece_count, uptime_pct,
                        downtime_pct, idle_sessions_count, idle_time_s, avg_utilization_pct
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        source_note, hour_start, source_note, hour_start, hour_end,
                        piece_count, uptime_pct, downtime_pct, idle_sessions, int(round(idle_time_s)), avg_util
                    )
                )

                # Delete from CurrentHourMetrics
                cur.execute(
                    """
                    DELETE FROM dbo.CurrentHourMetrics
                    WHERE source_note = ? AND hour_start = ?
                    """,
                    (source_note, hour_start)
                )

                conn.commit()
                return True

        except Exception as e:
            print(f"❌ Finalize hour error: {e}")
            return False
