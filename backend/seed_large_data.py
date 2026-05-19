#!/usr/bin/env python
"""Generate large volume of test data (90 days of hourly metrics across 6 plants)."""

from datetime import datetime, timedelta
from app.db.connection import get_connection
import sys

def seed_hourly_metrics(days=90):
    """Insert 90 days of hourly metrics for 6 plants = 12,960 rows."""
    conn = get_connection()
    cur = conn.cursor()

    plants = ['SP3', 'SP4', 'SP5', 'SP6', 'SP7', 'SP8']
    base_time = datetime.now() - timedelta(days=days)

    inserted = 0
    failed = 0

    print(f"Generating {days} days × 24 hours × {len(plants)} plants = {days * 24 * len(plants):,} rows...")

    for day_offset in range(days):
        for hour_offset in range(24):
            for plant_idx, plant in enumerate(plants):
                hour_start = base_time + timedelta(days=day_offset, hours=hour_offset)
                hour_end = hour_start + timedelta(hours=1)

                # Varied metrics based on day/hour patterns
                day_of_week = (day_offset % 7)
                hour_of_day = hour_offset

                # Weekend has lower production
                is_weekend = day_of_week >= 5
                weekend_factor = 0.7 if is_weekend else 1.0

                # Off-hours (night shift) lower production
                is_night = hour_of_day < 6 or hour_of_day >= 22
                night_factor = 0.5 if is_night else 1.0

                # Base metrics with variation
                pieces = int((80 + (day_offset % 40) * 2) * weekend_factor * night_factor)
                uptime = 65 + (day_offset % 20) * 1.5 + (hour_of_day % 6) * 2
                uptime = min(95, max(40, uptime))
                downtime = 100 - uptime

                # Idle sessions more likely in night hours
                idle_sessions = 2 if is_night else (1 if hour_of_day % 4 == 0 else 0)
                idle_time_s = idle_sessions * 180
                idle_time_avg_s = 90 if idle_sessions > 0 else 0
                idle_time_peak_s = 180 if idle_sessions > 0 else 0

                avg_util = uptime * 0.8 + (plant_idx % 3) * 5

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

                    # Progress indicator
                    if inserted % 1000 == 0:
                        print(f"  {inserted:,} rows inserted...")

                except Exception as e:
                    failed += 1
                    if failed <= 5:
                        print(f"  Warning: {e}")

    conn.commit()
    print(f"\nSeeding complete!")
    print(f"  Inserted: {inserted:,} rows")
    print(f"  Failed: {failed:,} rows")

    # Show final count
    cur.execute("SELECT COUNT(*) FROM dbo.HourlyMetrics")
    total = cur.fetchone()[0]
    print(f"  Total HourlyMetrics rows: {total:,}")

if __name__ == "__main__":
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 90
    seed_hourly_metrics(days=days)
