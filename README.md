# Sales Pipeline Automation

Automated sales pipeline tool that:
1. **Pulls email data** from Gmail
2. **Pulls call transcripts** from Gong
3. **Schedules and sends nurture emails** to prospects with close dates months out

## Quick Start

### 1. Install dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

**Gmail setup:**
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create a project and enable the Gmail API
- Create OAuth 2.0 credentials and download `credentials.json` to the project root
- On first run, you'll be prompted to authorize in your browser

**Gong setup:**
- Go to your [Gong API settings](https://app.gong.io/company/api)
- Create an API key pair
- Add the access key and secret to `.env`

### 3. Run the server

```bash
uvicorn app.main:app --reload
```

The API runs at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/prospects/` | GET | List all prospects |
| `/prospects/` | POST | Add a new prospect |
| `/prospects/{id}` | GET | Get prospect details |
| `/prospects/{id}` | PUT | Update a prospect |
| `/prospects/{id}` | DELETE | Remove a prospect |
| `/prospects/{id}/activity` | GET | View all emails, calls, and nurture history |
| `/sync/gmail` | POST | Sync latest emails from Gmail |
| `/sync/gong` | POST | Sync latest call transcripts from Gong |
| `/sync/all` | POST | Sync both Gmail and Gong |
| `/nurture/run` | POST | Run full nurture cycle (find prospects, create sequences, send due emails) |
| `/nurture/pending` | GET | View pending nurture emails |
| `/nurture/send-due` | POST | Send all due nurture emails |
| `/dashboard/summary` | GET | Pipeline overview with stats and upcoming close dates |

## How It Works

### Adding Prospects

```bash
curl -X POST http://localhost:8000/prospects/ \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@acme.com",
    "name": "Jane Smith",
    "company": "Acme Corp",
    "expected_close_date": "2026-06-15",
    "deal_stage": "Negotiation"
  }'
```

### Syncing Data

```bash
# Sync emails from Gmail
curl -X POST http://localhost:8000/sync/gmail

# Sync calls from Gong
curl -X POST http://localhost:8000/sync/gong
```

### Running Nurture Campaigns

```bash
# Run a full nurture cycle
curl -X POST http://localhost:8000/nurture/run
```

This will:
1. Find all prospects with close dates within the configured window (default: 90 days)
2. Skip prospects who were contacted recently (default: within 7 days)
3. Create a 4-email nurture sequence spaced over 3 weeks
4. Send any emails that are due

### Automated Scheduling

The app runs a background scheduler that automatically:
- Syncs Gmail and Gong data
- Runs the nurture cycle

Default interval: every 24 hours (configurable via `NURTURE_CHECK_INTERVAL_HOURS`).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `NURTURE_CHECK_INTERVAL_HOURS` | 24 | How often the background scheduler runs |
| `NURTURE_DAYS_BEFORE_CLOSE` | 90 | Nurture prospects closing within this many days |
| `NURTURE_EMAIL_INTERVAL_DAYS` | 7 | Minimum days between contacts before re-nurturing |
