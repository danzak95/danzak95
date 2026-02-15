import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.call_transcript import CallTranscript
from app.models.prospect import Prospect

logger = logging.getLogger(__name__)


class GongService:
    def __init__(self):
        self.base_url = settings.gong_api_base_url.rstrip("/")
        self.access_key = settings.gong_access_key
        self.secret = settings.gong_access_key_secret

    def _auth(self) -> tuple[str, str]:
        return (self.access_key, self.secret)

    async def fetch_calls(self, days_back: int = 30) -> list[dict]:
        """Fetch recent calls from Gong API."""
        from_date = (datetime.utcnow() - timedelta(days=days_back)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        to_date = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/v2/calls",
                auth=self._auth(),
                json={
                    "filter": {
                        "fromDateTime": from_date,
                        "toDateTime": to_date,
                    }
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()

        return data.get("calls", [])

    async def fetch_transcript(self, call_id: str) -> dict:
        """Fetch the transcript for a specific call."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/v2/calls/transcript",
                auth=self._auth(),
                json={"filter": {"callIds": [call_id]}},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()

        transcripts = data.get("callTranscripts", [])
        if transcripts:
            return transcripts[0]
        return {}

    async def sync_calls(self, db: AsyncSession, days_back: int = 30) -> int:
        """Sync Gong calls and transcripts into the database."""
        if settings.demo_mode:
            logger.info("Demo mode: skipping live Gong sync (use seed_data.py for mock data)")
            return 0

        calls = await self.fetch_calls(days_back=days_back)
        synced_count = 0

        for call in calls:
            call_id = call.get("metaData", {}).get("id", "")
            if not call_id:
                continue

            # Skip if already synced
            existing = await db.execute(
                select(CallTranscript).where(
                    CallTranscript.gong_call_id == call_id
                )
            )
            if existing.scalar_one_or_none():
                continue

            # Fetch transcript
            transcript_data = await self.fetch_transcript(call_id)
            transcript_text = _format_transcript(transcript_data)

            # Extract participant emails
            parties = call.get("parties", [])
            participant_emails = [
                p.get("emailAddress", "").lower()
                for p in parties
                if p.get("emailAddress")
            ]
            participants_str = ", ".join(participant_emails)

            # Try to link to a prospect
            prospect = None
            for email in participant_emails:
                if email == settings.gmail_sender_email.lower():
                    continue
                result = await db.execute(
                    select(Prospect).where(Prospect.email == email)
                )
                prospect = result.scalar_one_or_none()
                if prospect:
                    break

            meta = call.get("metaData", {})
            call_date_str = meta.get("started", "")
            try:
                call_date = datetime.fromisoformat(
                    call_date_str.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                call_date = datetime.utcnow()

            record = CallTranscript(
                gong_call_id=call_id,
                prospect_id=prospect.id if prospect else None,
                title=meta.get("title", ""),
                call_date=call_date,
                duration_seconds=meta.get("duration"),
                transcript=transcript_text,
                key_topics=", ".join(call.get("content", {}).get("topics", [])),
                participants=participants_str,
            )
            db.add(record)

            # Update last contact on prospect
            if prospect:
                if (
                    not prospect.last_contact_date
                    or call_date > prospect.last_contact_date
                ):
                    prospect.last_contact_date = call_date

            synced_count += 1

        await db.commit()
        logger.info(f"Synced {synced_count} new calls from Gong")
        return synced_count


def _format_transcript(transcript_data: dict) -> str:
    """Format Gong transcript sentences into readable text."""
    sentences = transcript_data.get("transcript", [])
    lines = []
    for segment in sentences:
        speaker = segment.get("speakerName", "Unknown")
        for sentence in segment.get("sentences", []):
            text = sentence.get("text", "")
            lines.append(f"{speaker}: {text}")
    return "\n".join(lines)


gong_service = GongService()
