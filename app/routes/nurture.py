from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.nurture_schedule import NurtureSchedule
from app.services.nurture_service import nurture_service

router = APIRouter(prefix="/nurture", tags=["nurture"])


@router.post("/run")
async def run_nurture_cycle(db: AsyncSession = Depends(get_db)):
    """Run a full nurture cycle: find prospects, create sequences, send due emails."""
    result = await nurture_service.run_nurture_cycle(db)
    return result


@router.get("/pending")
async def list_pending_nurture_emails(db: AsyncSession = Depends(get_db)):
    """List all pending (unsent) nurture emails."""
    result = await db.execute(
        select(NurtureSchedule)
        .where(NurtureSchedule.sent == False)
        .order_by(NurtureSchedule.scheduled_date.asc())
    )
    schedules = result.scalars().all()
    return [
        {
            "id": s.id,
            "prospect_id": s.prospect_id,
            "subject": s.subject,
            "scheduled_date": s.scheduled_date.isoformat(),
        }
        for s in schedules
    ]


@router.post("/send-due")
async def send_due_emails(db: AsyncSession = Depends(get_db)):
    """Send all nurture emails that are past their scheduled date."""
    count = await nurture_service.send_due_emails(db)
    return {"emails_sent": count}
