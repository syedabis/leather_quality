#!/usr/bin/env python
"""
Real-time monitor for CurrentHourMetrics while inference runs.
Shows live updates from the database as frames are processed.

Run this in a separate terminal while run_live_preview.py is executing:
    python monitor_live_data.py
"""

import sys
import time
from datetime import datetime
from app.db.connection import get_connection


def clear_screen():
    """Clear terminal screen."""
    import os
    os.system('clear' if os.name != 'nt' else 'cls')


def format_uptime_pct(frame_count, uptime_frames):
    """Calculate uptime percentage safely."""
    if frame_count == 0:
        return 0.0
    return round((uptime_frames * 100.0 / frame_count), 1)


def format_avg_util(frame_count, sum_util):
    """Calculate average utilization safely."""
    if frame_count == 0:
        return 0.0
    return round((sum_util / frame_count), 1)


def get_current_hour_data():
    """Fetch CurrentHourMetrics for the current hour."""
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            now = datetime.now()
            hour_start = now.replace(minute=0, second=0, microsecond=0)

            cur.execute('''
                SELECT
                    source_note,
                    frame_count,
                    piece_count,
                    uptime_frames,
                    downtime_frames,
                    sum_utilization,
                    idle_sessions_count,
                    idle_time_s,
                    last_updated
                FROM dbo.CurrentHourMetrics
                WHERE hour_start = ?
                ORDER BY source_note
            ''', (hour_start,))

            rows = cur.fetchall()
            return hour_start, rows

    except Exception as e:
        return None, []


def display_data(hour_start, rows, iteration):
    """Display formatted data table."""
    clear_screen()

    now = datetime.now()
    print("╔" + "═" * 98 + "╗")
    print("║" + " REAL-TIME DATABASE MONITOR — CurrentHourMetrics".ljust(99) + "║")
    print("╠" + "═" * 98 + "╣")
    print(f"║ Hour: {hour_start.strftime('%H:%M')} — {now.strftime('%H:%M:%S')}  |  Update #{iteration:>4}".ljust(99) + "║")
    print("╠" + "═" * 98 + "╣")

    if not rows:
        print("║  (Waiting for data... make sure run_live_preview.py is executing)".ljust(99) + "║")
        print("╚" + "═" * 98 + "╝")
        return

    # Header
    header = "│  Plant │ Frames │ Pieces │ Uptime │ Downtime │ AvgUtil │ Idle Sess │ Idle Time │ Last Updated │"
    print(header)
    print("├" + "─" * 98 + "┤")

    total_frames = 0
    total_pieces = 0
    total_uptime_frames = 0
    total_downtime_frames = 0
    total_sum_util = 0
    total_idle_sessions = 0
    total_idle_time_s = 0

    for row in rows:
        (unit, frame_count, piece_count, uptime_frames, downtime_frames,
         sum_util, idle_sessions, idle_time_s, last_updated) = row

        uptime_pct = format_uptime_pct(frame_count, uptime_frames)
        downtime_pct = 100.0 - uptime_pct
        avg_util = format_avg_util(frame_count, sum_util)

        total_frames += frame_count
        total_pieces += piece_count
        total_uptime_frames += uptime_frames
        total_downtime_frames += downtime_frames
        total_sum_util += sum_util
        total_idle_sessions += idle_sessions
        total_idle_time_s += idle_time_s

        # Format: │  SP3  │  1234  │  567  │  78.5%  │  21.5%  │  65.2% │      2    │   360s   │ 14:23:45 │
        row_str = (
            f"│ {unit:>6} │ {frame_count:>6} │ {piece_count:>6} │ "
            f"{uptime_pct:>5.1f}% │ {downtime_pct:>7.1f}% │ {avg_util:>6.1f}% │ "
            f"{idle_sessions:>9} │ {idle_time_s:>8}s │ {last_updated.strftime('%H:%M:%S')} │"
        )
        print(row_str)

    # Totals
    print("├" + "─" * 98 + "┤")
    avg_uptime = format_uptime_pct(total_frames, total_uptime_frames)
    avg_downtime = 100.0 - avg_uptime
    avg_util_fleet = format_avg_util(total_frames, total_sum_util)

    totals_str = (
        f"│ TOTAL  │ {total_frames:>6} │ {total_pieces:>6} │ "
        f"{avg_uptime:>5.1f}% │ {avg_downtime:>7.1f}% │ {avg_util_fleet:>6.1f}% │ "
        f"{total_idle_sessions:>9} │ {total_idle_time_s:>8}s │            │"
    )
    print(totals_str)
    print("╚" + "═" * 98 + "╝")

    # Info
    print()
    print("📊 Info:")
    print(f"   • Frame rate: ~{max(1, total_frames // max(1, sum(1 for r in rows)))} fps per plant")
    print(f"   • Fleet uptime: {avg_uptime:.1f}%")
    print(f"   • Fleet utilization: {avg_util_fleet:.1f}%")
    print()
    print("Press Ctrl+C to stop monitoring")


def main():
    """Main monitoring loop."""
    iteration = 0
    last_frame_count = 0

    try:
        while True:
            iteration += 1
            hour_start, rows = get_current_hour_data()

            if hour_start:
                display_data(hour_start, rows, iteration)

                # Check if data is updating
                current_frame_count = sum(row[1] for row in rows) if rows else 0
                if current_frame_count > last_frame_count:
                    last_frame_count = current_frame_count
                    # Data is updating

            time.sleep(2)  # Refresh every 2 seconds

    except KeyboardInterrupt:
        print("\n\n✓ Monitoring stopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
