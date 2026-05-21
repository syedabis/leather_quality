"""
DB connection for the FastAPI backend.
Mirrors db_logger.py's connection pattern — same SQL Server, same credentials.
"""

import os
from dotenv import load_dotenv

load_dotenv()

try:
    import pyodbc
except ImportError:
    raise ImportError(
        "pyodbc not found. Install with: pip install pyodbc\n"
        "Also install an ODBC Driver for SQL Server (17 or 18):\n"
        "https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server"
    )

DB_SERVER   = os.getenv("DB_SERVER",   r"Dadaerp\sqlexpress")
DB_NAME     = os.getenv("DB_NAME",     "LeatherCount")
DB_USER     = os.getenv("DB_USER",     "")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")


def _get_driver() -> str:
    """Returns the highest-version MSSQL ODBC driver that is actually installed."""
    import re
    pattern = re.compile(r"^ODBC Driver (\d+) for SQL Server$")
    candidates = [(int(m.group(1)), d) for d in pyodbc.drivers() if (m := pattern.match(d))]
    if not candidates:
        raise RuntimeError(
            "No Microsoft ODBC Driver for SQL Server found. "
            "Install msodbcsql17 or msodbcsql18 from packages.microsoft.com."
        )
    return max(candidates)[1]


def _build_conn_str() -> str:
    driver = _get_driver()
    # Encrypt=no bypasses SSL legacy sigalg errors on older SQL Server instances (safe on LAN)
    extra = "TrustServerCertificate=yes;Encrypt=no;"

    if DB_USER and DB_PASSWORD:
        return (
            f"DRIVER={{{driver}}};"
            f"SERVER={DB_SERVER};"
            f"DATABASE={DB_NAME};"
            f"UID={DB_USER};"
            f"PWD={DB_PASSWORD};"
            f"{extra}"
        )
    return (
        f"DRIVER={{{driver}}};"
        f"SERVER={DB_SERVER};"
        f"DATABASE={DB_NAME};"
        f"Trusted_Connection=yes;"
        f"{extra}"
    )


def get_connection() -> pyodbc.Connection:
    return pyodbc.connect(_build_conn_str(), timeout=10)


def test_connection() -> dict:
    """Returns connection status dict — used by /health/db endpoint."""
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT @@VERSION")
            version = cur.fetchone()[0].split("\n")[0].strip()
        return {"status": "ok", "server": DB_SERVER, "database": DB_NAME, "version": version}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}
