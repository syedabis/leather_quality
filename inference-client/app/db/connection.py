import os
from pathlib import Path
from dotenv import load_dotenv

# Single source of truth: the .env next to docker-compose.yml at the project root.
# inference-client/app/db/connection.py  →  parents[3] is the project root.
_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
if _ROOT_ENV.exists():
    load_dotenv(_ROOT_ENV)
else:
    # Fallback for unusual layouts: try a local .env inside inference-client.
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")

try:
    import pyodbc
except ImportError:
    raise ImportError(
        "pyodbc not found. Install with: pip install pyodbc\n"
        "Also install an ODBC Driver for SQL Server (17 or 18):\n"
        "https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server"
    )

DB_SERVER   = os.getenv("DB_SERVER",   "localhost,1433")
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
    extra = "TrustServerCertificate=yes;"
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
