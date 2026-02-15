from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.gmail_service import gmail_service
from app.services.gong_service import gong_service

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/gmail")
async def sync_gmail(
    max_results: int = 100, db: AsyncSession = Depends(get_db)
):
    """Pull latest emails from Gmail and sync to database."""
    count = await gmail_service.sync_emails(db, max_results=max_results)
    return {"synced_emails": count}


@router.post("/gong")
async def sync_gong(
    days_back: int = 30, db: AsyncSession = Depends(get_db)
):
    """Pull latest call transcripts from Gong and sync to database."""
    count = await gong_service.sync_calls(db, days_back=days_back)
    return {"synced_calls": count}


@router.post("/all")
async def sync_all(db: AsyncSession = Depends(get_db)):
    """Sync both Gmail and Gong data."""
    email_count = await gmail_service.sync_emails(db)
    call_count = await gong_service.sync_calls(db)
    return {
        "synced_emails": email_count,
        "synced_calls": call_count,
    }
