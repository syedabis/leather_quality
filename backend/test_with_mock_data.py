#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Mock data tester: Generates realistic frame data and measures query performance.
Tests the hybrid caching analytics without needing real inference.
"""

import sys
import io
import time
import random
from datetime import datetime, timedelta
from pathlib import Path

# Fix encoding for Windows console
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.insert(0, str(Path(__file__).parent))

from app.db.connection import get_connection
from app.db.frame_processor import FrameProcessor
from app.db.schema import initialize_schema


class MockFrameGenerator:
    """Generates realistic mock frame data for testing."""

    PLANTS = ["SP3", "SP4", "SP5", "SP6", "SP7", "SP8"]

    def __init__(self, fps: int = 30):
        self.fps = fps
        self.frame_interval = 1.0 / fps  # seconds between frames
        self.piece_counters = {plant: random.randint(500, 2000) for plant in self.PLANTS}
        self.belt_states = {plant: random.choice([True, False]) for plant in self.PLANTS}
        self.idle_timers = {plant: 0 for plant in self.PLANTS}

    def generate_frame(self, plant: str, belt_active: bool = None) -> dict:
        """Generate a realistic frame for a plant."""
        if belt_active is None:
            belt_active = self.belt_states[plant]

        # Piece counting logic
        piece_delta = 1 if belt_active and random.random() < 0.7 else 0
        self.piece_counters[plant] += piece_delta

        # Utilization varies with belt state
        if belt_active:
            utilization = random.uniform(70, 95)
            self.idle_timers[plant] = 0
        else:
            utilization = random.uniform(5, 30)
            self.idle_timers[plant] += 1

        return {
            "source_note": plant,
            "total_count": self.piece_counters[plant],
            "belt_active": belt_active,
            "utilization_pct": utilization,
            "piece_delta": piece_delta,
        }

    def generate_session(self, plant: str, num_frames: int = 100) -> list:
        """Generate a session (continuous frames at fixed interval)."""
        frames = []
        for _ in range(num_frames):
            frame = self.generate_frame(plant)
            frames.append(frame)
        return frames


def insert_mock_data(num_hours: int = 24, fps: int = 30):
    """
    Insert mock frame data for testing.

    Args:
        num_hours: How many hours of data to generate (default: 24)
        fps: Frames per second (default: 30)
    """
    print(f"\n🔄 Generating {num_hours} hours of mock data at {fps} fps...")
    print(f"   (Total frames: {num_hours * 3600 * fps:,})")

    generator = MockFrameGenerator(fps=fps)

    # Calculate frames per hour
    frames_per_hour = 3600 * fps
    total_frames = 0

    # Generate data for each hour
    for hour_offset in range(num_hours):
        print(f"\n📊 Hour {hour_offset + 1}/{num_hours}:")

        for plant in generator.PLANTS:
            # Randomly set belt state (70% active, 30% idle)
            belt_active = random.random() < 0.7

            # Generate frames for this hour
            for frame_num in range(frames_per_hour):
                frame = generator.generate_frame(plant, belt_active)

                # Occasionally toggle belt state (every 300-600 frames)
                if frame_num % random.randint(300, 600) == 0:
                    belt_active = not belt_active

                # Process frame (updates CurrentHourMetrics)
                FrameProcessor.process_frame(
                    source_note=frame["source_note"],
                    total_count=frame["total_count"],
                    belt_active=frame["belt_active"],
                    utilization_pct=frame["utilization_pct"],
                    piece_delta=frame["piece_delta"],
                )

                total_frames += 1

        # Show progress
        if (hour_offset + 1) % 4 == 0 or hour_offset == 0:
            print(f"   ✅ {total_frames:,} frames processed")

    print(f"\n✅ Mock data generation complete: {total_frames:,} frames")
    return total_frames


def measure_query_performance():
    """Measure performance of analytics queries."""
    print("\n" + "=" * 70)
    print("📈 QUERY PERFORMANCE MEASUREMENTS")
    print("=" * 70)

    today = datetime.now().strftime("%Y-%m-%d")
    week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    measurements = []

    # Test 1: Hourly query
    print("\n1️⃣  Hourly Analytics Query")
    print(f"   Query: /api/analytics/by-hour?date={today}&unit=SP3")
    with get_connection() as conn:
        cur = conn.cursor()
        start = time.perf_counter()
        cur.execute("EXEC sp_analytics_by_hour @unit=?, @date=?", ("SP3", today))
        rows = cur.fetchall()
        elapsed = (time.perf_counter() - start) * 1000  # milliseconds

        measurements.append(("Hourly (1 hour)", elapsed, len(rows)))
        print(f"   Time: {elapsed:.2f}ms")
        print(f"   Rows returned: {len(rows)}")

    # Test 2: Daily query
    print("\n2️⃣  Daily Analytics Query")
    print(f"   Query: /api/analytics/by-day?from={week_ago}&to={today}")
    with get_connection() as conn:
        cur = conn.cursor()
        start = time.perf_counter()
        cur.execute("EXEC sp_analytics_by_day @unit=?, @from_date=?, @to_date=?",
                   ("SP3", week_ago, today))
        rows = cur.fetchall()
        elapsed = (time.perf_counter() - start) * 1000

        measurements.append(("Daily (7 days)", elapsed, len(rows)))
        print(f"   Time: {elapsed:.2f}ms")
        print(f"   Rows returned: {len(rows)}")

    # Test 3: Shift query
    print("\n3️⃣  Shift Analytics Query")
    print(f"   Query: /api/analytics/by-shift?from={week_ago}&to={today}")
    with get_connection() as conn:
        cur = conn.cursor()
        start = time.perf_counter()
        cur.execute("EXEC sp_analytics_by_shift @unit=?, @from_date=?, @to_date=?",
                   ("SP3", week_ago, today))
        rows = cur.fetchall()
        elapsed = (time.perf_counter() - start) * 1000

        measurements.append(("Shift (7 days × 3)", elapsed, len(rows)))
        print(f"   Time: {elapsed:.2f}ms")
        print(f"   Rows returned: {len(rows)}")

    # Performance summary
    print("\n" + "=" * 70)
    print("📊 PERFORMANCE SUMMARY")
    print("=" * 70)
    print(f"{'Query':<30} {'Time (ms)':<15} {'Rows':<10}")
    print("-" * 70)

    all_pass = True
    for query_name, elapsed, row_count in measurements:
        status = "✅ PASS" if elapsed < 20 else "⚠️  SLOW"
        if elapsed >= 20:
            all_pass = False
        print(f"{query_name:<30} {elapsed:<15.2f} {row_count:<10} {status}")

    print("-" * 70)

    if all_pass:
        print("✅ All queries under 20ms target!")
    else:
        print("⚠️  Some queries exceeded target (<20ms)")

    return measurements


def check_table_sizes():
    """Show table sizes and row counts."""
    print("\n" + "=" * 70)
    print("📦 TABLE STATISTICS")
    print("=" * 70)

    tables = [
        ("CurrentHourMetrics", "Running hour aggregates"),
        ("HourlyMetrics", "Completed hours"),
        ("LeatherCountLog", "Raw frame data"),
    ]

    with get_connection() as conn:
        cur = conn.cursor()

        print(f"\n{'Table':<30} {'Rows':<15} {'Notes':<30}")
        print("-" * 75)

        for table_name, notes in tables:
            cur.execute(f"SELECT COUNT(*) FROM dbo.{table_name}")
            row_count = cur.fetchone()[0]
            print(f"{table_name:<30} {row_count:<15,} {notes:<30}")

    print()


def main():
    print("=" * 70)
    print("SPRAY PLANT ANALYTICS — MOCK DATA PERFORMANCE TEST")
    print("=" * 70)

    # Step 1: Initialize schema
    print("\n1️⃣  Initializing database schema...")
    try:
        initialize_schema()
        print("   ✅ Schema initialized")
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False

    # Step 2: Generate mock data
    print("\n2️⃣  Generating mock data...")
    try:
        # Generate 24 hours of data at 30 fps
        # This creates ~2.5M frames across 6 plants
        total_frames = insert_mock_data(num_hours=24, fps=30)
        print(f"   ✅ Generated {total_frames:,} mock frames")
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False

    # Step 3: Check table sizes
    print("\n3️⃣  Analyzing table sizes...")
    check_table_sizes()

    # Step 4: Measure query performance
    print("\n4️⃣  Measuring query performance...")
    try:
        measurements = measure_query_performance()
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False

    # Summary
    print("\n" + "=" * 70)
    print("✅ MOCK DATA TEST COMPLETE")
    print("=" * 70)
    print("\nNext steps:")
    print("1. Start the backend:")
    print("   uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload")
    print("\n2. Test endpoints:")
    print("   curl 'http://localhost:8001/api/analytics/by-hour?date=2026-04-30&unit=SP3'")
    print("   curl 'http://localhost:8001/api/analytics/by-day?from=2026-04-23&to=2026-04-30'")
    print("\n3. Check performance matches measurements above")
    print()

    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
