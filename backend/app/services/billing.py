"""Razorpay self-serve subscription — UPI AutoPay for Indian SMBs.

Report-validated pricing: ₹2,000–5,000/month self-serve tiers. Flow:
  1. create a Razorpay Plan (once) → 2. create a Subscription for the customer
  (UPI AutoPay-eligible) → 3. Razorpay Checkout collects the UPI mandate →
  4. webhook confirms activation → we flip Org.plan.

Runs in test mode with test keys; without keys, endpoints report the seam is
unconfigured instead of failing.
"""

import hashlib
import hmac
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

RAZORPAY_API = "https://api.razorpay.com/v1"

# Price points in paise (₹ * 100). Enterprise is contact-sales.
PLANS = {
    "self-serve": {"name": "Self-serve (MFD / RIA)", "amount": 250000, "period": "monthly",
                   "reviews_per_month": 200, "description": "Unlimited-ish pre-checks for a solo distributor"},
    "pro": {"name": "Pro (multi-user)", "amount": 500000, "period": "monthly",
            "reviews_per_month": 1000, "description": "Team seats, priority queue, WhatsApp bot"},
    "enterprise": {"name": "Enterprise (AMC / NBFC / Insurer)", "amount": None, "period": "monthly",
                   "reviews_per_month": None, "description": "SSO, audit exports, dedicated corpus"},
}


@dataclass
class SubscriptionResult:
    configured: bool
    subscription: dict | None = None
    message: str = ""


def available() -> bool:
    return bool(get_settings().razorpay_key_id and get_settings().razorpay_key_secret)


def _auth() -> tuple[str, str]:
    s = get_settings()
    return (s.razorpay_key_id, s.razorpay_key_secret)


async def _ensure_plan(client: httpx.AsyncClient, plan_key: str) -> str:
    """Create (idempotently by notes) a Razorpay plan and return its id.
    In production you'd cache plan ids; here we create on demand."""
    p = PLANS[plan_key]
    resp = await client.post(f"{RAZORPAY_API}/plans", json={
        "period": p["period"],
        "interval": 1,
        "item": {"name": p["name"], "amount": p["amount"], "currency": "INR", "description": p["description"]},
        "notes": {"plan_key": plan_key, "product": "ComplianceCopilot"},
    })
    resp.raise_for_status()
    return resp.json()["id"]


async def create_subscription(plan_key: str, customer_email: str) -> SubscriptionResult:
    if plan_key not in PLANS or PLANS[plan_key]["amount"] is None:
        return SubscriptionResult(False, message=f"Plan '{plan_key}' is not self-serve purchasable")
    if not available():
        return SubscriptionResult(False, message="Razorpay keys not configured (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)")

    async with httpx.AsyncClient(auth=_auth(), timeout=30) as client:
        plan_id = await _ensure_plan(client, plan_key)
        # total_count = 12 monthly cycles; UPI AutoPay mandate is collected at checkout.
        resp = await client.post(f"{RAZORPAY_API}/subscriptions", json={
            "plan_id": plan_id,
            "total_count": 12,
            "customer_notify": 1,
            "notes": {"plan_key": plan_key, "email": customer_email},
        })
        resp.raise_for_status()
        sub = resp.json()
        return SubscriptionResult(True, subscription={
            "id": sub["id"],
            "short_url": sub.get("short_url"),  # hosted UPI AutoPay checkout link
            "status": sub.get("status"),
            "plan_key": plan_key,
            "razorpay_key_id": get_settings().razorpay_key_id,  # public, for Checkout.js
        })


def verify_webhook(body: bytes, signature: str) -> bool:
    """Verify the X-Razorpay-Signature HMAC on a webhook payload."""
    secret = get_settings().razorpay_webhook_secret
    if not secret:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")
