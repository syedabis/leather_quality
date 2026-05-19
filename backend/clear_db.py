#!/usr/bin/env python
"""Clear all data from database tables for fresh start."""

from app.db.connection import get_connection

with get_connection() as conn:
    cur = conn.cursor()

    # Force clear all tables
    tables = ['CurrentHourMetrics', 'HourlyMetrics', 'DailyMetrics', 'LeatherCountLog', 'LeatherSessions', 'IdlePeriods']

    print('Clearing database tables...')
    print('')

    for table in tables:
        try:
            cur.execute(f'TRUNCATE TABLE dbo.{table}')
            print(f'  OK - {table}')
        except Exception as e:
            print(f'  Skip - {table}: {e}')

    conn.commit()

    # Verify
    print('')
    print('Final Status:')
    print('')

    total = 0
    for table in tables:
        cur.execute(f'SELECT COUNT(*) FROM dbo.{table}')
        count = cur.fetchone()[0]
        total += count
        print(f'  {table:<25} {count:>3} rows')

    print('')
    print('=' * 45)
    if total == 0:
        print('SUCCESS: Database is completely empty!')
        print('Ready to run inference with fresh data.')
    else:
        print(f'WARNING: {total} rows still in database')
    print('=' * 45)
