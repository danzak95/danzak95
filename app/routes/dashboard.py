from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.prospect import Prospect
from app.models.email_record import EmailRecord
from app.models.call_transcript import CallTranscript
from app.models.nurture_schedule import NurtureSchedule

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
async def get_dashboard_summary(db: AsyncSession = Depends(get_db)):
    """Get a high-level summary of the pipeline."""
    total_prospects = await db.execute(select(func.count(Prospect.id)))
    total_emails = await db.execute(select(func.count(EmailRecord.id)))
    total_calls = await db.execute(select(func.count(CallTranscript.id)))
    pending_nurtures = await db.execute(
        select(func.count(NurtureSchedule.id)).where(
            NurtureSchedule.sent == False
        )
    )
    sent_nurtures = await db.execute(
        select(func.count(NurtureSchedule.id)).where(
            NurtureSchedule.sent == True
        )
    )

    # Prospects closing soon (next 30 days)
    now = datetime.utcnow().date()
    from datetime import timedelta

    closing_soon = await db.execute(
        select(Prospect)
        .where(
            Prospect.expected_close_date.isnot(None),
            Prospect.expected_close_date <= now + timedelta(days=30),
            Prospect.expected_close_date >= now,
        )
        .order_by(Prospect.expected_close_date.asc())
    )

    return {
        "total_prospects": total_prospects.scalar(),
        "total_emails_synced": total_emails.scalar(),
        "total_calls_synced": total_calls.scalar(),
        "pending_nurture_emails": pending_nurtures.scalar(),
        "sent_nurture_emails": sent_nurtures.scalar(),
        "closing_soon": [
            {
                "id": p.id,
                "name": p.name,
                "email": p.email,
                "company": p.company,
                "expected_close_date": p.expected_close_date.isoformat(),
                "deal_stage": p.deal_stage,
            }
            for p in closing_soon.scalars().all()
        ],
    }
