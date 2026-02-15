import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.database import init_db
from app.routes import dashboard, nurture, prospects, sync
from app.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    start_scheduler()
    yield
    # Shutdown
    stop_scheduler()


app = FastAPI(
    title="Sales Pipeline Automation",
    description=(
        "Automated sales pipeline tool that syncs Gmail emails and Gong call "
        "transcripts, then schedules nurture email campaigns to prospects "
        "with close dates months ahead."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(prospects.router)
app.include_router(sync.router)
app.include_router(nurture.router)
app.include_router(dashboard.router)


@app.get("/")
async def root():
    return {
        "app": "Sales Pipeline Automation",
        "docs": "/docs",
        "endpoints": {
            "prospects": "/prospects",
            "sync_gmail": "/sync/gmail",
            "sync_gong": "/sync/gong",
            "sync_all": "/sync/all",
            "run_nurture": "/nurture/run",
            "pending_nurtures": "/nurture/pending",
            "dashboard": "/dashboard/summary",
        },
    }
