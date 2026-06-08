"""
FastAPI backend — entry point.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.db.connection import test_connection
from app.db.schema import initialize_schema
from app.routers.counts import router as counts_router
from app.routers.settings import router as settings_router
from app.routers.reports import router as reports_router
from app.routers.analytics import router as analytics_router
from app.routers.sessions import router as sessions_router
from app.websocket.live import router as ws_router
from app.websocket.plants import router as ws_plants_router
from app.websocket.plant_feed import router as ws_plant_feed_router

app = FastAPI(title="SprayPlant API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(counts_router)
app.include_router(settings_router)
app.include_router(reports_router)
app.include_router(analytics_router)
app.include_router(sessions_router)
app.include_router(ws_router)
app.include_router(ws_plants_router)
app.include_router(ws_plant_feed_router)


@app.on_event("startup")
async def startup_event():
    """Initialize schema on startup (safe to call multiple times)."""
    try:
        initialize_schema()
        print("✅ Database schema initialized")
    except Exception as e:
        print(f"⚠️ Schema initialization warning: {e}")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/db")
def health_db():
    return test_connection()


@app.post("/admin/init-schema")
def init_schema():
    """Initialize/migrate database schema. Safe to call multiple times."""
    try:
        initialize_schema()
        return {"status": "ok", "message": "Schema initialization complete"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
