from datetime import datetime
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CallTranscript(Base):
    __tablename__ = "call_transcripts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    gong_call_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    prospect_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("prospects.id"), nullable=True
    )
    title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    call_date: Mapped[datetime] = mapped_column(DateTime)
    duration_seconds: Mapped[Optional[int]] = mapped_column(nullable=True)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    key_topics: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    participants: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
