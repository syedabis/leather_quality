#!/usr/bin/env python
"""Quick script to populate HourlyMetrics with realistic test data."""

from datetime import datetime, timedelta
from app.db.connection import get_connection

def seed_hourly_metrics():
    """Insert test data directly into HourlyMetrics for the last 7 days."""
    conn = get_connection()
    cur = conn.cursor()

    # Last 7 days of hourly data (6 plants × 24 hours × 7 days = 1008 rows)
    plants = ['SP3', 'SP4', 'SP5', 'SP6', 'SP7', 'SP8']
    base_time = datetime.now() - timedelta(days=7)

    inserted = 0
    for day_offset in range(7):
        for hour_offset in range(24):
            for plant in plants:
                hour_start = base_time + timedelta(days=day_offset, hours=hour_offset)
                hour_end = hour_start + timedelta(hours=1)

                # Realistic metrics
                pieces = 50 + (day_offset % 3) * 20 + (hour_offset % 6) * 5
                uptime = 70 + (day_offset % 4) * 5 + (hour_offset % 3) * 3
                downtime = 100 - uptime
                idle_sessions = 1 if hour_offset % 4 == 0 else 0
                idle_time_s = idle_sessions * 180
                idle_time_avg_s = 90 if idle_sessions > 0 else 0
                idle_time_peak_s = 180 if idle_sessions > 0 else 0
                avg_util = 65 + (day_offset % 5) * 5

                sql = """
                INSERT INTO dbo.HourlyMetrics
                (source_note, hour_start, hour_end, piece_count, uptime_pct, downtime_pct,
                 idle_sessions_count, idle_time_s, idle_time_avg_s, idle_time_peak_s, avg_utilization_pct)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """
                try:
                    cur.execute(sql, (
                        plant, hour_start, hour_end,
                        pieces, uptime, downtime,
                        idle_sessions, idle_time_s, idle_time_avg_s, idle_time_peak_s, avg_util
                    ))
                    inserted += 1
                except Exception as e:
                    pass  # Ignore duplicates

    conn.commit()
    print(f"Seeded {inserted} hourly metrics rows")

if __name__ == "__main__":
    seed_hourly_metrics()
