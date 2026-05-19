#!/usr/bin/env python
"""
Test API endpoints: Make requests to the running backend and measure response times.
Run after: (1) setup_db.py, (2) test_with_mock_data.py, (3) backend is running
"""

import sys
import time
import requests
import json
from datetime import datetime, timedelta


BASE_URL = "http://localhost:8001"
TIMEOUT = 5


def test_health():
    """Test health endpoint."""
    print("\n1️⃣  Testing /health endpoint...")
    try:
        start = time.perf_counter()
        resp = requests.get(f"{BASE_URL}/health", timeout=TIMEOUT)
        elapsed = (time.perf_counter() - start) * 1000

        if resp.status_code == 200:
            print(f"   ✅ PASS ({elapsed:.2f}ms)")
            print(f"   Response: {resp.json()}")
            return True
        else:
            print(f"   ❌ FAIL: Status {resp.status_code}")
            return False
    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        return False


def test_health_db():
    """Test database health endpoint."""
    print("\n2️⃣  Testing /health/db endpoint...")
    try:
        start = time.perf_counter()
        resp = requests.get(f"{BASE_URL}/health/db", timeout=TIMEOUT)
        elapsed = (time.perf_counter() - start) * 1000

        if resp.status_code == 200:
            result = resp.json()
            print(f"   ✅ PASS ({elapsed:.2f}ms)")
            print(f"   Database: {result['database']}")
            print(f"   Server: {result['server']}")
            return True
        else:
            print(f"   ❌ FAIL: Status {resp.status_code}")
            return False
    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        print(f"   (Is backend running on port 8001?)")
        return False


def test_analytics_by_hour():
    """Test hourly analytics endpoint."""
    print("\n3️⃣  Testing /api/analytics/by-hour endpoint...")
    today = datetime.now().strftime("%Y-%m-%d")

    try:
        url = f"{BASE_URL}/api/analytics/by-hour?date={today}&unit=SP3"
        print(f"   URL: {url}")

        start = time.perf_counter()
        resp = requests.get(url, timeout=TIMEOUT)
        elapsed = (time.perf_counter() - start) * 1000

        if resp.status_code == 200:
            data = resp.json()
            print(f"   ✅ PASS ({elapsed:.2f}ms)")
            print(f"   Rows returned: {len(data)}")
            if data:
                print(f"   Sample row: {json.dumps(data[0], indent=2)}")
            return True
        else:
            print(f"   ❌ FAIL: Status {resp.status_code}")
            print(f"   Response: {resp.text}")
            return False
    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        return False


def test_analytics_by_day():
    """Test daily analytics endpoint."""
    print("\n4️⃣  Testing /api/analytics/by-day endpoint...")
    today = datetime.now().strftime("%Y-%m-%d")
    week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    try:
        url = f"{BASE_URL}/api/analytics/by-day?from={week_ago}&to={today}&unit=SP3"
        print(f"   URL: {url}")

        start = time.perf_counter()
        resp = requests.get(url, timeout=TIMEOUT)
        elapsed = (time.perf_counter() - start) * 1000

        if resp.status_code == 200:
            data = resp.json()
            print(f"   ✅ PASS ({elapsed:.2f}ms)")
            print(f"   Rows returned: {len(data)}")
            if data:
                print(f"   Sample row: {json.dumps(data[0], indent=2)}")
            return True
        else:
            print(f"   ❌ FAIL: Status {resp.status_code}")
            print(f"   Response: {resp.text}")
            return False
    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        return False


def test_analytics_by_shift():
    """Test shift analytics endpoint."""
    print("\n5️⃣  Testing /api/analytics/by-shift endpoint...")
    today = datetime.now().strftime("%Y-%m-%d")
    week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    try:
        url = f"{BASE_URL}/api/analytics/by-shift?from={week_ago}&to={today}&unit=SP3"
        print(f"   URL: {url}")

        start = time.perf_counter()
        resp = requests.get(url, timeout=TIMEOUT)
        elapsed = (time.perf_counter() - start) * 1000

        if resp.status_code == 200:
            data = resp.json()
            print(f"   ✅ PASS ({elapsed:.2f}ms)")
            print(f"   Rows returned: {len(data)}")
            if data:
                print(f"   Sample row: {json.dumps(data[0], indent=2)}")
            return True
        else:
            print(f"   ❌ FAIL: Status {resp.status_code}")
            print(f"   Response: {resp.text}")
            return False
    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        return False


def test_performance():
    """Run performance test: 100 requests to measure response time distribution."""
    print("\n6️⃣  Running performance test (100 requests to by-hour endpoint)...")
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"{BASE_URL}/api/analytics/by-hour?date={today}&unit=SP3"

    try:
        times = []
        for i in range(100):
            start = time.perf_counter()
            resp = requests.get(url, timeout=TIMEOUT)
            elapsed = (time.perf_counter() - start) * 1000

            if resp.status_code == 200:
                times.append(elapsed)
            else:
                print(f"   ❌ Request {i+1} failed with status {resp.status_code}")
                return False

            if (i + 1) % 20 == 0:
                print(f"   {i+1}/100 requests completed...")

        # Calculate statistics
        times.sort()
        avg = sum(times) / len(times)
        min_time = times[0]
        max_time = times[-1]
        p50 = times[50]
        p95 = times[95]
        p99 = times[99]

        print(f"   ✅ All 100 requests succeeded")
        print(f"\n   Response time statistics:")
        print(f"   Min: {min_time:.2f}ms")
        print(f"   P50: {p50:.2f}ms")
        print(f"   P95: {p95:.2f}ms")
        print(f"   P99: {p99:.2f}ms")
        print(f"   Max: {max_time:.2f}ms")
        print(f"   Avg: {avg:.2f}ms")

        if p99 < 20:
            print(f"\n   ✅ Excellent! P99 is under 20ms target")
        elif p95 < 20:
            print(f"\n   ⚠️  Good, but P99 is {p99:.2f}ms (over 20ms target)")
        else:
            print(f"\n   ⚠️  Performance needs optimization")

        return True

    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        return False


def main():
    print("=" * 70)
    print("SPRAY PLANT ANALYTICS — API ENDPOINT TESTS")
    print("=" * 70)
    print("\nMake sure backend is running:")
    print("  uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload")

    results = []

    # Run tests
    results.append(("Health", test_health()))
    results.append(("Health/DB", test_health_db()))
    results.append(("Analytics/by-hour", test_analytics_by_hour()))
    results.append(("Analytics/by-day", test_analytics_by_day()))
    results.append(("Analytics/by-shift", test_analytics_by_shift()))
    results.append(("Performance (100 req)", test_performance()))

    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)

    print(f"\n{'Test':<30} {'Result':<10}")
    print("-" * 40)

    all_pass = True
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{test_name:<30} {status:<10}")
        if not passed:
            all_pass = False

    print("-" * 40)

    if all_pass:
        print("\n✅ All tests passed!")
    else:
        print("\n⚠️  Some tests failed. Check errors above.")

    return all_pass


if __name__ == "__main__":
    try:
        success = main()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n❌ Tests interrupted by user")
        sys.exit(1)
