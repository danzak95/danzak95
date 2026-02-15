import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.database import async_session
from app.services.gmail_service import gmail_service
from app.services.gong_service import gong_service
from app.services.nurture_service import nurture_service

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def scheduled_sync_and_nurture():
    """Background job: sync data from Gmail + Gong, then run nurture cycle."""
    logger.info("Running scheduled sync and nurture cycle...")

    async with async_session() as db:
        try:
            email_count = await gmail_service.sync_emails(db)
            logger.info(f"Synced {email_count} emails")
        except Exception as e:
            logger.error(f"Gmail sync failed: {e}")

        try:
            call_count = await gong_service.sync_calls(db)
            logger.info(f"Synced {call_count} calls")
        except Exception as e:
            logger.error(f"Gong sync failed: {e}")

        try:
            result = await nurture_service.run_nurture_cycle(db)
            logger.info(f"Nurture cycle result: {result}")
        except Exception as e:
            logger.error(f"Nurture cycle failed: {e}")


def start_scheduler():
    """Start the background scheduler."""
    scheduler.add_job(
        scheduled_sync_and_nurture,
        "interval",
        hours=settings.nurture_check_interval_hours,
        id="sync_and_nurture",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        f"Scheduler started - running every {settings.nurture_check_interval_hours} hours"
    )


def stop_scheduler():
    """Stop the background scheduler."""
    scheduler.shutdown()
    logger.info("Scheduler stopped")
