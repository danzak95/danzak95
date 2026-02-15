import base64
import logging
from datetime import datetime
from email.mime.text import MIMEText
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.email_record import EmailRecord
from app.models.prospect import Prospect

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]


class GmailService:
    def __init__(self):
        self._service = None

    def _get_service(self):
        """Authenticate and return the Gmail API service."""
        if self._service:
            return self._service

        creds = None
        token_path = Path(settings.gmail_token_file)
        creds_path = Path(settings.gmail_credentials_file)

        if token_path.exists():
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not creds_path.exists():
                    raise FileNotFoundError(
                        f"Gmail credentials file not found: {creds_path}. "
                        "Download it from Google Cloud Console."
                    )
                flow = InstalledAppFlow.from_client_secrets_file(
                    str(creds_path), SCOPES
                )
                creds = flow.run_local_server(port=0)

            token_path.write_text(creds.to_json())

        self._service = build("gmail", "v1", credentials=creds)
        return self._service

    def fetch_emails(self, max_results: int = 100, query: str = "") -> list[dict]:
        """Fetch emails from Gmail inbox."""
        service = self._get_service()
        results = (
            service.users()
            .messages()
            .list(userId="me", maxResults=max_results, q=query)
            .execute()
        )

        messages = results.get("messages", [])
        email_data = []

        for msg in messages:
            detail = (
                service.users()
                .messages()
                .get(userId="me", id=msg["id"], format="metadata")
                .execute()
            )

            headers = {
                h["name"].lower(): h["value"]
                for h in detail.get("payload", {}).get("headers", [])
            }

            email_data.append(
                {
                    "id": msg["id"],
                    "sender": headers.get("from", ""),
                    "recipient": headers.get("to", ""),
                    "subject": headers.get("subject", ""),
                    "snippet": detail.get("snippet", ""),
                    "date": headers.get("date", ""),
                    "internal_date": detail.get("internalDate", ""),
                }
            )

        return email_data

    async def sync_emails(self, db: AsyncSession, max_results: int = 100) -> int:
        """Sync emails from Gmail into the database and link to prospects."""
        if settings.demo_mode:
            logger.info("Demo mode: skipping live Gmail sync (use seed_data.py for mock data)")
            return 0

        emails = self.fetch_emails(max_results=max_results)
        synced_count = 0

        for email in emails:
            # Skip if already synced
            existing = await db.execute(
                select(EmailRecord).where(
                    EmailRecord.gmail_message_id == email["id"]
                )
            )
            if existing.scalar_one_or_none():
                continue

            # Determine direction
            sender = email["sender"]
            is_outbound = settings.gmail_sender_email.lower() in sender.lower()
            contact_email = (
                email["recipient"] if is_outbound else _extract_email(sender)
            )

            # Find or skip prospect
            prospect = await db.execute(
                select(Prospect).where(Prospect.email == contact_email)
            )
            prospect = prospect.scalar_one_or_none()

            # Parse date
            try:
                received_at = datetime.fromtimestamp(
                    int(email["internal_date"]) / 1000
                )
            except (ValueError, TypeError):
                received_at = datetime.utcnow()

            record = EmailRecord(
                gmail_message_id=email["id"],
                prospect_id=prospect.id if prospect else None,
                sender=sender,
                recipient=email["recipient"],
                subject=email["subject"],
                snippet=email["snippet"],
                direction="outbound" if is_outbound else "inbound",
                received_at=received_at,
            )
            db.add(record)

            # Update last contact date on prospect
            if prospect:
                if (
                    not prospect.last_contact_date
                    or received_at > prospect.last_contact_date
                ):
                    prospect.last_contact_date = received_at

            synced_count += 1

        await db.commit()
        logger.info(f"Synced {synced_count} new emails from Gmail")
        return synced_count

    def send_email(self, to: str, subject: str, body: str) -> dict:
        """Send an email via Gmail."""
        if settings.demo_mode:
            logger.info(f"Demo mode: would send email to {to} - {subject}")
            return {"id": "demo-message", "labelIds": ["SENT"]}

        service = self._get_service()

        message = MIMEText(body, "html")
        message["to"] = to
        message["from"] = settings.gmail_sender_email
        message["subject"] = subject

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        sent = (
            service.users()
            .messages()
            .send(userId="me", body={"raw": raw})
            .execute()
        )

        logger.info(f"Sent email to {to}: {subject}")
        return sent


def _extract_email(from_header: str) -> str:
    """Extract email address from a 'Name <email>' format header."""
    if "<" in from_header and ">" in from_header:
        return from_header.split("<")[1].split(">")[0].strip().lower()
    return from_header.strip().lower()


gmail_service = GmailService()
