from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.prospect import Prospect
from app.services.nurture_service import nurture_service

router = APIRouter(prefix="/prospects", tags=["prospects"])


class ProspectCreate(BaseModel):
    email: str
    name: str
    company: Optional[str] = None
    expected_close_date: Optional[date] = None
    deal_stage: Optional[str] = None
    pain_point: Optional[str] = None
    risk: Optional[str] = None
    notes: Optional[str] = None


class ProspectResponse(BaseModel):
    id: int
    email: str
    name: str
    company: Optional[str]
    expected_close_date: Optional[date]
    deal_stage: Optional[str]
    pain_point: Optional[str]
    risk: Optional[str]
    last_contact_date: Optional[datetime]
    notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


@router.post("/", response_model=ProspectResponse)
async def create_prospect(
    prospect_data: ProspectCreate, db: AsyncSession = Depends(get_db)
):
    """Add a new prospect to the pipeline."""
    existing = await db.execute(
        select(Prospect).where(Prospect.email == prospect_data.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Prospect with this email already exists")

    prospect = Prospect(**prospect_data.model_dump())
    db.add(prospect)
    await db.commit()
    await db.refresh(prospect)
    return prospect


@router.get("/", response_model=list[ProspectResponse])
async def list_prospects(db: AsyncSession = Depends(get_db)):
    """List all prospects."""
    result = await db.execute(
        select(Prospect).order_by(Prospect.expected_close_date.asc())
    )
    return list(result.scalars().all())


@router.get("/{prospect_id}", response_model=ProspectResponse)
async def get_prospect(prospect_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific prospect."""
    result = await db.execute(
        select(Prospect).where(Prospect.id == prospect_id)
    )
    prospect = result.scalar_one_or_none()
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect not found")
    return prospect


@router.put("/{prospect_id}", response_model=ProspectResponse)
async def update_prospect(
    prospect_id: int,
    prospect_data: ProspectCreate,
    db: AsyncSession = Depends(get_db),
):
    """Update a prospect."""
    result = await db.execute(
        select(Prospect).where(Prospect.id == prospect_id)
    )
    prospect = result.scalar_one_or_none()
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect not found")

    for key, value in prospect_data.model_dump(exclude_unset=True).items():
        setattr(prospect, key, value)

    await db.commit()
    await db.refresh(prospect)
    return prospect


@router.delete("/{prospect_id}")
async def delete_prospect(prospect_id: int, db: AsyncSession = Depends(get_db)):
    """Remove a prospect."""
    result = await db.execute(
        select(Prospect).where(Prospect.id == prospect_id)
    )
    prospect = result.scalar_one_or_none()
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect not found")

    await db.delete(prospect)
    await db.commit()
    return {"detail": "Prospect deleted"}


@router.get("/{prospect_id}/activity")
async def get_prospect_activity(
    prospect_id: int, db: AsyncSession = Depends(get_db)
):
    """Get all activity (emails, calls, nurture schedule) for a prospect."""
    result = await db.execute(
        select(Prospect).where(Prospect.id == prospect_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Prospect not found")

    return await nurture_service.get_prospect_activity(db, prospect_id)
