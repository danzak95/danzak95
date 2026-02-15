from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.prospect import Prospect
from app.models.email_record import EmailRecord
from app.models.call_transcript import CallTranscript
from app.models.nurture_schedule import NurtureSchedule

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

templates = Jinja2Templates(
    directory=str(Path(__file__).resolve().parent.parent / "templates")
)


@router.get("/summary")
async def get_dashboard_summary(db: AsyncSession = Depends(get_db)):
    """Get a high-level summary of the pipeline (JSON API)."""
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

    now = datetime.utcnow().date()
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


def _stage_class(stage: str | None) -> str:
    if not stage:
        return ""
    s = stage.lower()
    if "discovery" in s:
        return "discovery"
    if "qualification" in s:
        return "qualification"
    if "proposal" in s:
        return "proposal"
    if "negotiation" in s:
        return "negotiation"
    if "contract" in s:
        return "contract"
    if "verbal" in s:
        return "verbal"
    return ""


@router.get("/", response_class=HTMLResponse)
async def dashboard_ui(request: Request, db: AsyncSession = Depends(get_db)):
    """Serve the visual dashboard."""
    now = datetime.utcnow()
    today = now.date()

    # Summary stats
    total_prospects = (await db.execute(select(func.count(Prospect.id)))).scalar()
    total_emails = (await db.execute(select(func.count(EmailRecord.id)))).scalar()
    total_calls = (await db.execute(select(func.count(CallTranscript.id)))).scalar()
    pending_nurtures = (
        await db.execute(
            select(func.count(NurtureSchedule.id)).where(NurtureSchedule.sent == False)
        )
    ).scalar()
    sent_nurtures = (
        await db.execute(
            select(func.count(NurtureSchedule.id)).where(NurtureSchedule.sent == True)
        )
    ).scalar()

    summary = {
        "total_prospects": total_prospects,
        "total_emails_synced": total_emails,
        "total_calls_synced": total_calls,
        "pending_nurture_emails": pending_nurtures,
        "sent_nurture_emails": sent_nurtures,
    }

    # Prospects with activity counts
    all_prospects = (
        await db.execute(
            select(Prospect).order_by(Prospect.expected_close_date.asc())
        )
    ).scalars().all()

    prospects = []
    for p in all_prospects:
        email_count = (
            await db.execute(
                select(func.count(EmailRecord.id)).where(EmailRecord.prospect_id == p.id)
            )
        ).scalar()
        call_count = (
            await db.execute(
                select(func.count(CallTranscript.id)).where(CallTranscript.prospect_id == p.id)
            )
        ).scalar()

        days_out = (p.expected_close_date - today).days if p.expected_close_date else None

        if days_out is not None:
            if days_out <= 14:
                days_class = "days-urgent"
            elif days_out <= 30:
                days_class = "days-soon"
            else:
                days_class = "days-ok"
        else:
            days_class = ""

        last_contact_display = "Never"
        if p.last_contact_date:
            delta = (now - p.last_contact_date).days
            if delta == 0:
                last_contact_display = "Today"
            elif delta == 1:
                last_contact_display = "Yesterday"
            else:
                last_contact_display = f"{delta} days ago"

        close_date_display = p.expected_close_date.strftime("%b %d, %Y") if p.expected_close_date else "—"

        prospects.append({
            "id": p.id,
            "name": p.name,
            "email": p.email,
            "company": p.company,
            "deal_stage": p.deal_stage,
            "stage_class": _stage_class(p.deal_stage),
            "close_date_display": close_date_display,
            "days_out": days_out,
            "days_class": days_class,
            "last_contact_display": last_contact_display,
            "email_count": email_count,
            "call_count": call_count,
        })

    # Nurture emails (pending and recent sent)
    nurture_records = (
        await db.execute(
            select(NurtureSchedule)
            .where(
                (NurtureSchedule.sent == False)
                | (NurtureSchedule.sent_at > now - timedelta(days=7))
            )
            .order_by(NurtureSchedule.scheduled_date.asc())
        )
    ).scalars().all()

    nurtures = []
    for n in nurture_records:
        prospect_result = await db.execute(
            select(Prospect).where(Prospect.id == n.prospect_id)
        )
        prospect = prospect_result.scalar_one_or_none()

        if n.sent:
            status_label = "Sent"
            status_class = "status-sent"
        elif n.scheduled_date <= now:
            status_label = "Due"
            status_class = "status-due"
        else:
            status_label = "Scheduled"
            status_class = "status-pending"

        scheduled_display = n.scheduled_date.strftime("%b %d, %Y")

        nurtures.append({
            "prospect_name": prospect.name if prospect else "Unknown",
            "subject": n.subject,
            "scheduled_display": scheduled_display,
            "status_label": status_label,
            "status_class": status_class,
        })

    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "summary": summary,
            "prospects": prospects,
            "nurtures": nurtures,
            "demo_mode": settings.demo_mode,
        },
    )
