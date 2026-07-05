"""Single-tenant MVP auth: one seeded org/user behind a static bearer token.

The dependency shape (current_user injected everywhere) is what Stage 3
multi-tenant auth will slot into — only this module should need to change.
"""

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.models import Org, User

SEED_ORG_NAME = "Demo Distributors"
SEED_USER_EMAIL = "demo@example.com"


def seed_default_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == SEED_USER_EMAIL))
    if user:
        return user
    org = Org(name=SEED_ORG_NAME)
    db.add(org)
    db.flush()
    user = User(
        org_id=org.id,
        email=SEED_USER_EMAIL,
        name="Demo MFD",
        arn_number="ARN-12345",
    )
    db.add(user)
    db.commit()
    return user


def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User:
    settings = get_settings()
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
    if token != settings.api_token:
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")
    return seed_default_user(db)
