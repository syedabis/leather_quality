#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Database setup script: Initialize schema and verify connectivity.
Run this once after deploying the backend to set up all tables and indexes.
"""

import sys
import io
from pathlib import Path

# Fix encoding for Windows console
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from app.db.connection import test_connection
from app.db.schema import initialize_schema


def main():
    print("=" * 60)
    print("Spray Plant Analytics — Database Setup")
    print("=" * 60)

    # Test connection
    print("\n1. Testing database connection...")
    result = test_connection()
    if result["status"] != "ok":
        print(f"❌ Connection failed: {result['detail']}")
        return False
    print(f"✅ Connected to {result['server']}/{result['database']}")
    print(f"   Version: {result['version']}")

    # Initialize schema
    print("\n2. Initializing schema...")
    try:
        initialize_schema()
        print("✅ Schema initialized successfully")
    except Exception as e:
        print(f"❌ Schema initialization failed: {e}")
        return False

    # Verify tables exist
    print("\n3. Verifying tables...")
    try:
        from app.db.connection import get_connection
        with get_connection() as conn:
            cur = conn.cursor()

            # Check each table
            tables = [
                "LeatherCountLog",
                "CurrentHourMetrics",
                "HourlyMetrics",
                "DailyMetrics",
            ]

            for table in tables:
                cur.execute(
                    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME=?",
                    (table,)
                )
                if cur.fetchone()[0] > 0:
                    print(f"  ✅ {table}")
                else:
                    print(f"  ❌ {table} not found")
                    return False

    except Exception as e:
        print(f"❌ Verification failed: {e}")
        return False

    # Verify stored procedures
    print("\n4. Verifying stored procedures...")
    try:
        with get_connection() as conn:
            cur = conn.cursor()

            procs = [
                "sp_analytics_by_hour",
                "sp_analytics_by_day",
                "sp_analytics_by_shift",
            ]

            for proc in procs:
                cur.execute(
                    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_NAME=?",
                    (proc,)
                )
                if cur.fetchone()[0] > 0:
                    print(f"  ✅ {proc}")
                else:
                    print(f"  ❌ {proc} not found")
                    return False

    except Exception as e:
        print(f"❌ Procedure verification failed: {e}")
        return False

    # Verify indexes
    print("\n5. Verifying indexes...")
    try:
        with get_connection() as conn:
            cur = conn.cursor()

            # Check covering index on LeatherCountLog
            cur.execute(
                """
                SELECT COUNT(*) FROM sys.indexes
                WHERE name = 'idx_source_saved_belt'
                AND object_id = OBJECT_ID('LeatherCountLog')
                """
            )
            if cur.fetchone()[0] > 0:
                print(f"  ✅ idx_source_saved_belt (LeatherCountLog)")
            else:
                print(f"  ⚠️  idx_source_saved_belt not found (may already exist)")

    except Exception as e:
        print(f"⚠️  Index verification warning: {e}")

    print("\n" + "=" * 60)
    print("✅ Database setup complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Start the backend:")
    print("   uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload")
    print("\n2. Test the analytics endpoints:")
    print("   curl 'http://localhost:8001/api/analytics/by-hour?date=2026-04-30&unit=SP3'")
    print("\n3. Integrate frame processing in your inference handler:")
    print("   from app.db.frame_processor import FrameProcessor")
    print("   FrameProcessor.process_frame('SP3', total_count, belt_active, util_pct)")
    print("\nDocumentation: IMPLEMENTATION_NOTES.md")

    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
