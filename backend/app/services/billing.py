"""Entitlements + Razorpay seam (Stage 2 pricing: self-serve INR tiers).

The MVP keeps billing OUT of the review path — entitlement is a plan label on
the Org. When Razorpay keys are configured, create_subscription_order returns
a real Razorpay order for the selected plan (UPI AutoPay-friendly); without
keys it reports the seam as unconfigured instead of failing reviews.
"""

from dataclasses import dataclass

import httpx

from app.core.config import get_settings

# Report-validated price points: ₹2,000–5,000/month self-serve tiers.
PLANS = {
    "self-serve": {"name": "Self-serve (MFD/RIA)", "inr_per_month": 2500, "reviews_per_month": 200},
    "pro": {"name": "Pro (multi-user)", "inr_per_month": 5000, "reviews_per_month": 1000},
    "enterprise": {"name": "Enterprise (AMC/NBFC/Insurer)", "inr_per_month": None, "reviews_per_month": None},
}


@dataclass
class OrderResult:
    configured: bool
    order: dict | None = None
    message: str = ""


async def create_subscription_order(plan: str) -> OrderResult:
    settings = get_settings()
    if plan not in PLANS or PLANS[plan]["inr_per_month"] is None:
        return OrderResult(configured=False, message=f"Plan '{plan}' is not self-serve purchasable")
    if not (settings.razorpay_key_id and settings.razorpay_key_secret):
        return OrderResult(
            configured=False,
            message="Razorpay keys not configured (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)",
        )
    async with httpx.AsyncClient(auth=(settings.razorpay_key_id, settings.razorpay_key_secret)) as client:
        resp = await client.post(
            "https://api.razorpay.com/v1/orders",
            json={
                "amount": PLANS[plan]["inr_per_month"] * 100,  # paise
                "currency": "INR",
                "notes": {"plan": plan},
            },
        )
        resp.raise_for_status()
        return OrderResult(configured=True, order=resp.json())
