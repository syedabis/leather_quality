from datetime import datetime
from typing import Optional
from app.db.connection import get_connection


class FrameProcessor:

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
        try:
            now        = datetime.now()
            hour_start = now.replace(minute=0, second=0, microsecond=0)

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
                    (source_note, hour_start, source_note, hour_start)
                )
                cur.execute(
                    """
                    UPDATE dbo.CurrentHourMetrics
                    SET
                        frame_count          = frame_count + 1,
                        piece_count          = piece_count + ?,
                        uptime_frames        = uptime_frames + ?,
                        downtime_frames      = downtime_frames + ?,
                        sum_utilization      = sum_utilization + ?,
                        idle_time_s          = idle_time_s + ?,
                        idle_sessions_count  = idle_sessions_count + ?,
                        last_updated         = GETDATE()
                    WHERE source_note = ? AND hour_start = ?
                    """,
                    (
                        piece_delta,
                        1 if belt_active else 0,
                        0 if belt_active else 1,
                        utilization_pct,
                        frame_time_delta_s if not belt_active else 0,
                        idle_sessions_delta,
                        source_note,
                        hour_start,
                    )
                )
                conn.commit()
                return True

        except Exception as e:
            print(f"❌ DB write error: {e}")
            return False

    @staticmethod
    def finalize_hour(source_note: str, hour_start: datetime) -> bool:
        try:
            with get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT frame_count, piece_count, uptime_frames,
                           idle_sessions_count, idle_time_s, sum_utilization
                    FROM dbo.CurrentHourMetrics
                    WHERE source_note = ? AND hour_start = ?
                    """,
                    (source_note, hour_start)
                )
                row = cur.fetchone()
                if not row:
                    return False

                frame_count, piece_count, uptime_frames, idle_sessions, idle_time_s, sum_util = row
                uptime_pct   = (uptime_frames * 100.0 / max(frame_count, 1)) if frame_count > 0 else 0
                downtime_pct = 100 - uptime_pct
                avg_util     = (sum_util / max(frame_count, 1)) if frame_count > 0 else 0
                hour_end     = hour_start.replace(hour=hour_start.hour + 1) if hour_start.hour < 23 else hour_start.replace(hour=0, day=hour_start.day + 1)

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
                        source_note, hour_start,
                        source_note, hour_start, hour_end,
                        piece_count, uptime_pct, downtime_pct,
                        idle_sessions, int(round(idle_time_s)), avg_util,
                    )
                )
                cur.execute(
                    "DELETE FROM dbo.CurrentHourMetrics WHERE source_note = ? AND hour_start = ?",
                    (source_note, hour_start)
                )
                conn.commit()
                return True

        except Exception as e:
            print(f"❌ Finalize hour error: {e}")
            return False
