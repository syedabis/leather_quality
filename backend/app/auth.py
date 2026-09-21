"""
Clerk session-token verification for admin-only endpoints.
"""
import base64
import os

import jwt
from fastapi import Header, HTTPException, Depends


def _clerk_issuer() -> str:
    publishable_key = os.environ.get("CLERK_PUBLISHABLE_KEY", "") or os.environ.get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k")

    # Format: pk_test_<base64>  or  pk_live_<base64>, where <base64> decodes to "<host>$"
    _, _, encoded = publishable_key.partition("_test_")
    if not encoded:
        _, _, encoded = publishable_key.partition("_live_")

    padded = encoded + "=" * (-len(encoded) % 4)
    host = base64.b64decode(padded).decode("utf-8").rstrip("$")
    return f"https://{host}"


_ISSUER = _clerk_issuer()
_JWKS_URL = f"{_ISSUER}/.well-known/jwks.json"
_jwks_client = jwt.PyJWKClient(_JWKS_URL)


def get_current_claims(authorization: str | None = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=_ISSUER,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    return claims


def _dashboard_role(claims: dict) -> str | None:
    """Mirrors dashboard/lib/access.ts getDashboardAccess() — nested
    metadata.dashboard.role, falling back to the legacy flat metadata.role
    for accounts created before the dashboard/mobile access split."""
    metadata = claims.get("metadata", {}) or {}
    dashboard = metadata.get("dashboard")
    if dashboard:
        return dashboard.get("role") if dashboard.get("enabled") else None
    return metadata.get("role")


def require_admin(claims: dict = Depends(get_current_claims)) -> dict:
    if not claims or not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or missing session token")
    role = _dashboard_role(claims)
    if role and role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return claims
