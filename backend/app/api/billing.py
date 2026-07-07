from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.db import get_db
from app.models import Org, User
from app.services import billing

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plans")
def list_plans(user: User = Depends(get_current_user)):
    return {
        "configured": billing.available(),
        "plans": [{"id": k, **v} for k, v in billing.PLANS.items()],
    }


@router.post("/subscribe/{plan}")
async def subscribe(plan: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = await billing.create_subscription(plan, user.email)
    if not result.configured:
        raise HTTPException(status_code=501, detail=result.message)
    return result.subscription


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    """Razorpay activation webhook — flips the org plan once UPI AutoPay is set up."""
    body = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")
    if not billing.verify_webhook(body, sig):
        raise HTTPException(status_code=400, detail="Invalid signature")
    import json

    event = json.loads(body)
    if event.get("event") in ("subscription.activated", "subscription.charged"):
        notes = (event.get("payload", {}).get("subscription", {}).get("entity", {}).get("notes", {}))
        plan_key = notes.get("plan_key")
        email = notes.get("email")
        if plan_key and email:
            user = db.query(User).filter(User.email == email).first()
            if user:
                org = db.get(Org, user.org_id)
                if org:
                    org.plan = plan_key
                    db.commit()
    return {"ok": True}
