import logging
from datetime import datetime, timedelta

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.prospect import Prospect
from app.models.email_record import EmailRecord
from app.models.call_transcript import CallTranscript
from app.models.nurture_schedule import NurtureSchedule
from app.services.gmail_service import gmail_service

logger = logging.getLogger(__name__)

# Nurture email templates based on how far out the close date is
NURTURE_TEMPLATES = [
    {
        "offset_days": 0,
        "subject": "Checking in - {prospect_name}",
        "body": (
            "<p>Hi {prospect_name},</p>"
            "<p>I wanted to check in and see how things are going on your end. "
            "Is there anything I can help with or any questions I can answer?</p>"
            "<p>Looking forward to hearing from you.</p>"
            "<p>Best regards</p>"
        ),
    },
    {
        "offset_days": 7,
        "subject": "Quick resource for you - {prospect_name}",
        "body": (
            "<p>Hi {prospect_name},</p>"
            "<p>I came across some information that might be useful for your team "
            "as you evaluate next steps. Happy to walk through it whenever works for you.</p>"
            "<p>Let me know if you'd like to set up a quick call.</p>"
            "<p>Best regards</p>"
        ),
    },
    {
        "offset_days": 14,
        "subject": "Following up on our conversation - {prospect_name}",
        "body": (
            "<p>Hi {prospect_name},</p>"
            "<p>I wanted to follow up on our last conversation and see if you've "
            "had a chance to discuss things internally. I'm here to help with "
            "anything your team might need to move forward.</p>"
            "<p>Would it be helpful to schedule a brief call this week?</p>"
            "<p>Best regards</p>"
        ),
    },
    {
        "offset_days": 21,
        "subject": "Thinking of your timeline - {prospect_name}",
        "body": (
            "<p>Hi {prospect_name},</p>"
            "<p>I know your team is targeting a decision around {close_date}, "
            "and I want to make sure we're aligned on next steps so there are "
            "no surprises as that date approaches.</p>"
            "<p>Is there a good time to connect this week?</p>"
            "<p>Best regards</p>"
        ),
    },
]


class NurtureService:
    async def get_prospects_needing_nurture(
        self, db: AsyncSession
    ) -> list[Prospect]:
        """Find prospects with close dates months out that need nurturing."""
        now = datetime.utcnow()
        nurture_horizon = now + timedelta(days=settings.nurture_days_before_close)
        min_last_contact = now - timedelta(days=settings.nurture_email_interval_days)

        result = await db.execute(
            select(Prospect).where(
                and_(
                    Prospect.expected_close_date.isnot(None),
                    Prospect.expected_close_date > now.date(),
                    Prospect.expected_close_date <= nurture_horizon.date(),
                    # Only nurture prospects not recently contacted
                    (
                        (Prospect.last_contact_date.is_(None))
                        | (Prospect.last_contact_date < min_last_contact)
                    ),
                )
            )
        )
        return list(result.scalars().all())

    async def create_nurture_sequence(
        self, db: AsyncSession, prospect: Prospect
    ) -> list[NurtureSchedule]:
        """Create a nurture email sequence for a prospect."""
        # Check if there are already pending nurture emails
        existing = await db.execute(
            select(NurtureSchedule).where(
                and_(
                    NurtureSchedule.prospect_id == prospect.id,
                    NurtureSchedule.sent == False,
                )
            )
        )
        if existing.scalars().first():
            logger.info(
                f"Prospect {prospect.email} already has pending nurture emails"
            )
            return []

        schedules = []
        base_date = datetime.utcnow()

        for template in NURTURE_TEMPLATES:
            scheduled_date = base_date + timedelta(days=template["offset_days"])
            close_date_str = (
                prospect.expected_close_date.strftime("%B %d")
                if prospect.expected_close_date
                else "soon"
            )

            subject = template["subject"].format(
                prospect_name=prospect.name.split()[0]
            )
            body = template["body"].format(
                prospect_name=prospect.name.split()[0],
                close_date=close_date_str,
            )

            schedule = NurtureSchedule(
                prospect_id=prospect.id,
                scheduled_date=scheduled_date,
                subject=subject,
                body=body,
            )
            db.add(schedule)
            schedules.append(schedule)

        await db.commit()
        logger.info(
            f"Created {len(schedules)} nurture emails for {prospect.email}"
        )
        return schedules

    async def send_due_emails(self, db: AsyncSession) -> int:
        """Send all nurture emails that are due."""
        now = datetime.utcnow()

        result = await db.execute(
            select(NurtureSchedule).where(
                and_(
                    NurtureSchedule.sent == False,
                    NurtureSchedule.scheduled_date <= now,
                )
            )
        )
        due_emails = list(result.scalars().all())
        sent_count = 0

        for scheduled_email in due_emails:
            # Get the prospect
            prospect_result = await db.execute(
                select(Prospect).where(Prospect.id == scheduled_email.prospect_id)
            )
            prospect = prospect_result.scalar_one_or_none()
            if not prospect:
                continue

            try:
                gmail_service.send_email(
                    to=prospect.email,
                    subject=scheduled_email.subject,
                    body=scheduled_email.body,
                )
                scheduled_email.sent = True
                scheduled_email.sent_at = now
                prospect.last_contact_date = now
                sent_count += 1
            except Exception as e:
                logger.error(
                    f"Failed to send nurture email to {prospect.email}: {e}"
                )

        await db.commit()
        logger.info(f"Sent {sent_count} nurture emails")
        return sent_count

    async def run_nurture_cycle(self, db: AsyncSession) -> dict:
        """Run a full nurture cycle: find prospects, create sequences, send due emails."""
        # 1. Find prospects needing nurture
        prospects = await self.get_prospects_needing_nurture(db)
        logger.info(f"Found {len(prospects)} prospects needing nurture")

        # 2. Create nurture sequences for new prospects
        sequences_created = 0
        for prospect in prospects:
            created = await self.create_nurture_sequence(db, prospect)
            sequences_created += len(created)

        # 3. Send any due emails
        sent_count = await self.send_due_emails(db)

        return {
            "prospects_found": len(prospects),
            "sequences_created": sequences_created,
            "emails_sent": sent_count,
        }

    async def get_prospect_activity(
        self, db: AsyncSession, prospect_id: int
    ) -> dict:
        """Get all activity for a prospect (emails, calls, scheduled nurtures)."""
        emails = await db.execute(
            select(EmailRecord)
            .where(EmailRecord.prospect_id == prospect_id)
            .order_by(EmailRecord.received_at.desc())
        )
        calls = await db.execute(
            select(CallTranscript)
            .where(CallTranscript.prospect_id == prospect_id)
            .order_by(CallTranscript.call_date.desc())
        )
        nurtures = await db.execute(
            select(NurtureSchedule)
            .where(NurtureSchedule.prospect_id == prospect_id)
            .order_by(NurtureSchedule.scheduled_date.asc())
        )

        return {
            "emails": [
                {
                    "subject": e.subject,
                    "direction": e.direction,
                    "date": e.received_at.isoformat(),
                    "snippet": e.snippet,
                }
                for e in emails.scalars().all()
            ],
            "calls": [
                {
                    "title": c.title,
                    "date": c.call_date.isoformat(),
                    "duration_seconds": c.duration_seconds,
                    "key_topics": c.key_topics,
                }
                for c in calls.scalars().all()
            ],
            "nurture_emails": [
                {
                    "subject": n.subject,
                    "scheduled_date": n.scheduled_date.isoformat(),
                    "sent": n.sent,
                    "sent_at": n.sent_at.isoformat() if n.sent_at else None,
                }
                for n in nurtures.scalars().all()
            ],
        }


nurture_service = NurtureService()
