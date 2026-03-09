# CLAUDE.md — Sales Pipeline Automation

## Project Overview

This is a **FastAPI-based sales pipeline automation tool** that integrates with Gmail and Gong to:
1. Sync sales emails and call transcripts from external APIs
2. Identify prospects nearing their expected close dates
3. Automatically schedule and send nurture email sequences
4. Provide a visual HTML dashboard for pipeline monitoring

**Tech Stack:** Python 3.9+, FastAPI, SQLAlchemy (async), SQLite, APScheduler, Jinja2, Vanilla JS

---

## Repository Structure

```
danzak95/
├── app/
│   ├── main.py            # FastAPI app entry point, lifespan, router registration
│   ├── config.py          # Pydantic settings (env vars)
│   ├── database.py        # Async SQLAlchemy engine, session dependency
│   ├── scheduler.py       # APScheduler background job definitions
│   ├── models/
│   │   ├── prospect.py        # Prospect ORM model
│   │   ├── email_record.py    # EmailRecord ORM model
│   │   ├── call_transcript.py # CallTranscript ORM model
│   │   └── nurture_schedule.py# NurtureSchedule ORM model
│   ├── routes/
│   │   ├── prospects.py   # CRUD + activity timeline endpoints
│   │   ├── sync.py        # Gmail and Gong sync endpoints
│   │   ├── nurture.py     # Nurture campaign trigger endpoints
│   │   └── dashboard.py   # Dashboard JSON API + HTML UI
│   ├── services/
│   │   ├── gmail_service.py   # Gmail OAuth2 integration, email send/fetch
│   │   ├── gong_service.py    # Gong REST API integration
│   │   └── nurture_service.py # Nurture sequence logic, prospect activity
│   ├── templates/
│   │   └── dashboard.html     # Single-page Jinja2 HTML dashboard
│   └── utils/             # Utility helpers (extend as needed)
├── seed_data.py           # Standalone script to populate demo data
├── requirements.txt       # pip dependencies
├── .env.example           # Environment variable template
└── README.md              # Setup and usage guide
```

---

## Development Setup

### Prerequisites
- Python 3.9+
- A virtual environment is strongly recommended

### Install Dependencies
```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Environment Configuration
Copy `.env.example` to `.env` and fill in values:
```bash
cp .env.example .env
```

Key environment variables (see `app/config.py` for all):
| Variable | Default | Description |
|---|---|---|
| `GMAIL_CREDENTIALS_FILE` | `credentials.json` | Google OAuth credentials file |
| `GMAIL_TOKEN_FILE` | `token.json` | Saved OAuth token |
| `GMAIL_SENDER_EMAIL` | — | Email address to send from |
| `GONG_API_BASE_URL` | `https://api.gong.io/v2` | Gong API base URL |
| `GONG_ACCESS_KEY` | — | Gong API access key |
| `GONG_ACCESS_KEY_SECRET` | — | Gong API secret |
| `DEMO_MODE` | `false` | Skip real API calls; log instead |
| `NURTURE_CHECK_INTERVAL_HOURS` | `24` | Scheduler frequency |
| `NURTURE_DAYS_BEFORE_CLOSE` | `30` | Window for nurture eligibility |
| `NURTURE_EMAIL_INTERVAL_DAYS` | `7` | Days between nurture emails |
| `DATABASE_URL` | `sqlite+aiosqlite:///./sales_pipeline.db` | Database connection string |

### Running the Application
```bash
uvicorn app.main:app --reload
```

The app will be available at `http://localhost:8000`. Auto-generated API docs at `/docs`.

### Seeding Demo Data
```bash
python seed_data.py
```
Creates 8 prospect profiles with associated emails, call transcripts, and nurture schedules.

---

## Key Conventions

### Async Patterns
- All database operations use `async/await` with SQLAlchemy's async session.
- Route handler functions are `async def`.
- Session dependency is injected via `Depends(get_db)` from `app/database.py`.
- Always `await` DB queries; use `select()` statements, not legacy `session.query()`.

### Configuration Access
- Import the singleton settings object: `from app.config import settings`
- Never hardcode API keys, URLs, or thresholds — always use `settings.*`.

### Demo Mode
- `settings.demo_mode` is `True` when `DEMO_MODE=true` in `.env`.
- In demo mode, Gmail and Gong services log actions instead of making real API calls.
- `seed_data.py` is the companion tool for demo mode — use it to populate the database.

### Database Models
- All models live in `app/models/` and inherit from `Base` (`app/database.py`).
- Use `Optional[str]` (not `str | None`) for nullable columns — required for Python 3.9 compatibility.
- Timestamps use `datetime.utcnow` as defaults.
- Add indexes to columns used in `WHERE` clauses (e.g., `email`, `prospect_id`, `scheduled_date`).

### Route Organization
| Router file | Prefix | Responsibility |
|---|---|---|
| `prospects.py` | `/prospects` | CRUD for Prospect records + activity timeline |
| `sync.py` | `/sync` | Trigger Gmail/Gong data ingestion |
| `nurture.py` | `/nurture` | Run nurture cycle, list/send pending emails |
| `dashboard.py` | `/dashboard` | Summary stats (JSON) + HTML UI |

All routers are registered in `app/main.py`.

### Service Layer
- Business logic lives in `app/services/`, not in route handlers.
- Services accept a `db: AsyncSession` argument and return domain objects or simple dicts.
- `nurture_service.py` owns the 4-email sequence template (offsets: 0, 7, 14, 21 days).
- `gmail_service.py` uses Google OAuth2 — token is auto-refreshed and persisted to `token.json`.

### Scheduler
- `app/scheduler.py` sets up an `AsyncIOScheduler` (APScheduler 3.x).
- The scheduler is started/stopped in the FastAPI lifespan (`app/main.py`).
- Interval is driven by `settings.nurture_check_interval_hours`.
- Add new periodic jobs here; do not use background tasks in route handlers for recurring work.

### Python 3.9 Compatibility
- Use `Optional[X]` from `typing` instead of `X | None` union syntax.
- Use `List[X]`, `Dict[K, V]` from `typing` instead of built-in generics where needed.
- The `greenlet` package is required for SQLAlchemy async support on Python 3.9.

---

## API Endpoints Reference

### Prospects
- `GET /prospects/` — List all prospects
- `POST /prospects/` — Create prospect
- `GET /prospects/{id}` — Get single prospect
- `PUT /prospects/{id}` — Update prospect
- `DELETE /prospects/{id}` — Delete prospect
- `GET /prospects/{id}/activity` — Timeline of emails, calls, nurtures

### Sync
- `POST /sync/gmail?max_results=50` — Pull recent emails from Gmail
- `POST /sync/gong?days_back=30` — Pull recent Gong calls
- `POST /sync/all` — Run both syncs

### Nurture
- `POST /nurture/run` — Run full nurture cycle (identify + schedule + send)
- `GET /nurture/pending` — List scheduled but unsent nurture emails
- `POST /nurture/send-due` — Send all emails due today or earlier

### Dashboard
- `GET /dashboard/summary` — JSON stats (prospect count, email count, call count, nurture count)
- `GET /dashboard/` — Rendered HTML dashboard

---

## Data Models Summary

| Model | Key Fields |
|---|---|
| `Prospect` | `email` (unique), `name`, `company`, `expected_close_date`, `deal_stage`, `last_contact_date`, `pain_point`, `risk_level` |
| `EmailRecord` | `gmail_message_id` (unique), `prospect_id` (FK), `direction` (inbound/outbound), `sender`, `recipient`, `subject` |
| `CallTranscript` | `gong_call_id` (unique), `prospect_id` (FK), `title`, `call_date`, `transcript_text`, `key_topics` |
| `NurtureSchedule` | `prospect_id` (FK), `scheduled_date`, `email_subject`, `email_body`, `sent` (bool), `sent_at` |

---

## Common Tasks

### Add a New API Endpoint
1. Add handler to the appropriate file in `app/routes/`.
2. Register any new router in `app/main.py` if creating a new file.
3. Put business logic in `app/services/`, not in the route handler.

### Add a New Database Model
1. Create `app/models/<name>.py` inheriting from `Base`.
2. Import the model in `app/database.py` (or `app/main.py`) so it is registered before `create_all`.
3. Use `Optional[str]` for nullable fields (Python 3.9 compatibility).

### Add a New Configuration Value
1. Add the field to `Settings` in `app/config.py` with a default.
2. Add the variable to `.env.example` with a comment explaining it.

### Extend the Nurture Sequence
- Edit the `EMAIL_SEQUENCE` list in `app/services/nurture_service.py`.
- Each entry is a dict with `offset_days`, `subject`, and `body` keys.

### Run Without Real API Credentials
Set `DEMO_MODE=true` in `.env`, then run `python seed_data.py` to populate the database before starting the server.

---

## No Test Suite (Current State)

There are currently **no automated tests**. When adding tests:
- Use `pytest` with `pytest-asyncio` for async route/service testing.
- Use an in-memory SQLite DB (`:memory:`) for test isolation.
- Mock Gmail and Gong HTTP calls with `unittest.mock` or `respx` (for httpx).
