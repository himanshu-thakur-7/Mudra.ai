from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user
from app.models import User
from app.services.billing import PLANS, create_subscription_order

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plans")
def list_plans(user: User = Depends(get_current_user)):
    return [{"id": k, **v} for k, v in PLANS.items()]


@router.post("/orders/{plan}")
async def create_order(plan: str, user: User = Depends(get_current_user)):
    result = await create_subscription_order(plan)
    if not result.configured:
        raise HTTPException(status_code=501, detail=result.message)
    return result.order
