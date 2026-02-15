"""Seed the database with realistic mock data for demo/testing."""

import asyncio
from datetime import datetime, timedelta, date

from app.database import init_db, async_session
from app.models.prospect import Prospect
from app.models.email_record import EmailRecord
from app.models.call_transcript import CallTranscript
from app.models.nurture_schedule import NurtureSchedule


PROSPECTS = [
    {
        "email": "jane.smith@acmecorp.com",
        "name": "Jane Smith",
        "company": "Acme Corp",
        "expected_close_date": date.today() + timedelta(days=45),
        "deal_stage": "Negotiation",
        "last_contact_date": datetime.utcnow() - timedelta(days=10),
        "pain_point": "New hires taking 9+ months to hit quota. No structured onboarding program — reps are shadowing and figuring it out on their own.",
        "risk": "High",
        "notes": "Strong interest in enterprise plan. Needs VP approval.",
    },
    {
        "email": "mark.chen@globexinc.com",
        "name": "Mark Chen",
        "company": "Globex Inc",
        "expected_close_date": date.today() + timedelta(days=22),
        "deal_stage": "Proposal Sent",
        "last_contact_date": datetime.utcnow() - timedelta(days=3),
        "pain_point": "Hired 15 reps last quarter, 6 already churned. Ramp time is 7 months avg and leadership is losing patience with the ROI on new hires.",
        "risk": "Medium",
        "notes": "Proposal sent last week. Following up on pricing questions.",
    },
    {
        "email": "sarah.johnson@initech.io",
        "name": "Sarah Johnson",
        "company": "Initech",
        "expected_close_date": date.today() + timedelta(days=75),
        "deal_stage": "Discovery",
        "last_contact_date": datetime.utcnow() - timedelta(days=14),
        "pain_point": "Expanding into EMEA and need to ramp 20+ reps in a new market. Current playbook is US-only and doesn't translate.",
        "risk": "Low",
        "notes": "Initial demo went well. Wants to loop in their CTO.",
    },
    {
        "email": "david.park@umbrellaco.com",
        "name": "David Park",
        "company": "Umbrella Co",
        "expected_close_date": date.today() + timedelta(days=12),
        "deal_stage": "Contract Review",
        "last_contact_date": datetime.utcnow() - timedelta(days=2),
        "pain_point": "Top reps leaving because new hires are dead weight for 6 months. Managers spending 60% of time coaching instead of selling.",
        "risk": "Low",
        "notes": "Legal reviewing contract. Expected to sign this month.",
    },
    {
        "email": "lisa.wong@wayneenterprises.com",
        "name": "Lisa Wong",
        "company": "Wayne Enterprises",
        "expected_close_date": date.today() + timedelta(days=60),
        "deal_stage": "Qualification",
        "last_contact_date": datetime.utcnow() - timedelta(days=21),
        "pain_point": "Just went through a reorg — merged two sales teams with different methodologies. Need to get 50 reps on the same page fast.",
        "risk": "Medium",
        "notes": "Budget confirmed. Need to schedule technical deep-dive.",
    },
    {
        "email": "tom.miller@starkindustries.com",
        "name": "Tom Miller",
        "company": "Stark Industries",
        "expected_close_date": date.today() + timedelta(days=30),
        "deal_stage": "Negotiation",
        "last_contact_date": datetime.utcnow() - timedelta(days=5),
        "pain_point": "Ramp time is 8 months but board wants it at 4. New product launch in Q3 and the current team can't sell it yet — need to upskill and onboard simultaneously.",
        "risk": "High",
        "notes": "Negotiating multi-year deal. Wants volume discount.",
    },
    {
        "email": "rachel.green@centralpark.co",
        "name": "Rachel Green",
        "company": "Central Park Co",
        "expected_close_date": date.today() + timedelta(days=90),
        "deal_stage": "Discovery",
        "last_contact_date": None,
        "pain_point": "Series B company scaling from 5 to 25 reps. Founder-led sales — no repeatable process documented. Reps have zero playbook.",
        "risk": "Medium",
        "notes": "Inbound lead from webinar. Needs initial outreach.",
    },
    {
        "email": "james.wilson@hooli.com",
        "name": "James Wilson",
        "company": "Hooli",
        "expected_close_date": date.today() + timedelta(days=8),
        "deal_stage": "Verbal Commit",
        "last_contact_date": datetime.utcnow() - timedelta(days=1),
        "pain_point": "40% of new AEs miss quota in first year. Existing training is PowerPoint decks from 2022. No call coaching, no certification, no accountability.",
        "risk": "Low",
        "notes": "Verbally committed. Waiting on PO number.",
    },
]


def _mock_emails(prospect_id: int, prospect_email: str, count: int, days_back: int):
    """Generate mock email records."""
    records = []
    for i in range(count):
        is_outbound = i % 2 == 0
        received_at = datetime.utcnow() - timedelta(days=days_back - i * (days_back // max(count, 1)))
        records.append(
            EmailRecord(
                gmail_message_id=f"mock-{prospect_email}-{i}",
                prospect_id=prospect_id,
                sender="me@company.com" if is_outbound else prospect_email,
                recipient=prospect_email if is_outbound else "me@company.com",
                subject=[
                    "Re: Partnership opportunity",
                    "Follow-up on our call",
                    "Pricing details attached",
                    "Quick question about timeline",
                    "Re: Next steps",
                ][i % 5],
                snippet=[
                    "Thanks for the follow-up. I've shared this with our team...",
                    "Great talking with you today. As discussed, here are the...",
                    "Please find the pricing breakdown attached. Let me know if...",
                    "When would be a good time to reconnect? We're targeting...",
                    "Sounds good. Let's plan on moving forward with the...",
                ][i % 5],
                direction="outbound" if is_outbound else "inbound",
                received_at=received_at,
            )
        )
    return records


def _mock_calls(prospect_id: int, prospect_email: str, count: int, days_back: int):
    """Generate mock call transcript records."""
    records = []
    for i in range(count):
        call_date = datetime.utcnow() - timedelta(days=days_back - i * (days_back // max(count, 1)))
        records.append(
            CallTranscript(
                gong_call_id=f"mock-call-{prospect_email}-{i}",
                prospect_id=prospect_id,
                title=[
                    "Discovery Call",
                    "Product Demo",
                    "Pricing Discussion",
                    "Technical Deep Dive",
                    "Negotiation Call",
                ][i % 5],
                call_date=call_date,
                duration_seconds=[1800, 2700, 1200, 3600, 2400][i % 5],
                transcript=f"[Mock transcript for call {i + 1}]",
                key_topics=[
                    "budget, timeline, requirements",
                    "product features, integration, demo",
                    "pricing, contract terms, discount",
                    "API, security, scalability",
                    "terms, renewal, SLA",
                ][i % 5],
                participants=f"me@company.com, {prospect_email}",
            )
        )
    return records


def _mock_nurtures(prospect_id: int, prospect_name: str):
    """Generate mock nurture schedules."""
    first_name = prospect_name.split()[0]
    now = datetime.utcnow()
    return [
        NurtureSchedule(
            prospect_id=prospect_id,
            scheduled_date=now - timedelta(days=14),
            subject=f"Checking in - {first_name}",
            body=f"<p>Hi {first_name},</p><p>I wanted to check in and see how things are going...</p>",
            sent=True,
            sent_at=now - timedelta(days=14),
        ),
        NurtureSchedule(
            prospect_id=prospect_id,
            scheduled_date=now - timedelta(days=7),
            subject=f"Quick resource for you - {first_name}",
            body=f"<p>Hi {first_name},</p><p>I came across some information that might be useful...</p>",
            sent=True,
            sent_at=now - timedelta(days=7),
        ),
        NurtureSchedule(
            prospect_id=prospect_id,
            scheduled_date=now + timedelta(days=3),
            subject=f"Following up on our conversation - {first_name}",
            body=f"<p>Hi {first_name},</p><p>I wanted to follow up on our last conversation...</p>",
            sent=False,
        ),
        NurtureSchedule(
            prospect_id=prospect_id,
            scheduled_date=now + timedelta(days=10),
            subject=f"Thinking of your timeline - {first_name}",
            body=f"<p>Hi {first_name},</p><p>I know your team is targeting a decision soon...</p>",
            sent=False,
        ),
    ]


async def seed():
    await init_db()
    async with async_session() as db:
        # Add prospects
        prospect_objects = []
        for p_data in PROSPECTS:
            prospect = Prospect(**p_data)
            db.add(prospect)
            prospect_objects.append(prospect)
        await db.flush()

        # Add mock activity for each prospect
        for i, prospect in enumerate(prospect_objects):
            email_count = [5, 4, 3, 6, 2, 4, 0, 7][i]
            call_count = [2, 1, 1, 3, 1, 2, 0, 3][i]
            days_back = [30, 20, 45, 15, 60, 25, 0, 10][i]

            for record in _mock_emails(prospect.id, prospect.email, email_count, days_back):
                db.add(record)

            for record in _mock_calls(prospect.id, prospect.email, call_count, days_back):
                db.add(record)

            # Add nurture sequences for prospects in active stages
            if prospect.deal_stage in ("Negotiation", "Proposal Sent", "Contract Review"):
                for record in _mock_nurtures(prospect.id, prospect.name):
                    db.add(record)

        await db.commit()
        print(f"Seeded {len(prospect_objects)} prospects with mock activity data.")


if __name__ == "__main__":
    asyncio.run(seed())
