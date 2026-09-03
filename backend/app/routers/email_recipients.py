from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, EmailStr
from typing import Optional
from app.auth import require_admin
from app.db.connection import get_connection

router = APIRouter(prefix="/api/settings/email-recipients", tags=["email-recipients"])


class EmailRecipientCreate(BaseModel):
    name: str = Field(..., max_length=100)
    email: EmailStr
    role: str = Field(..., description="MANAGER or DIRECTOR")
    allocated_plants: Optional[str] = Field(None, description="Comma-separated plants, e.g. 'SP-01,SP-05,SP-06' or None")


class EmailRecipientUpdate(BaseModel):
    name: str = Field(..., max_length=100)
    email: EmailStr
    role: str = Field(..., description="MANAGER or DIRECTOR")
    allocated_plants: Optional[str] = Field(None, description="Comma-separated plants, e.g. 'SP-01,SP-05,SP-06' or None")


@router.get("")
def get_email_recipients():
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, name, email, role, allocated_plants, created_at "
                "FROM dbo.EmailRecipients ORDER BY id DESC"
            )
            rows = cur.fetchall()
            return [
                {
                    "id": r[0],
                    "name": r[1],
                    "email": r[2],
                    "role": r[3],
                    "allocated_plants": r[4],
                    "created_at": r[5].isoformat() if r[5] else None,
                }
                for r in rows
            ]
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("", dependencies=[Depends(require_admin)])
def add_email_recipient(body: EmailRecipientCreate):
    # Normalize inputs
    role_upper = body.role.upper()
    if role_upper not in ("MANAGER", "DIRECTOR"):
        raise HTTPException(status_code=400, detail="Role must be MANAGER or DIRECTOR")
        
    allocated = body.allocated_plants if role_upper == "MANAGER" else None
    
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            # Check unique email
            cur.execute("SELECT COUNT(*) FROM dbo.EmailRecipients WHERE email = ?", (body.email,))
            if cur.fetchone()[0] > 0:
                raise HTTPException(status_code=409, detail="Email recipient already exists")
                
            cur.execute(
                "INSERT INTO dbo.EmailRecipients (name, email, role, allocated_plants) "
                "OUTPUT INSERTED.id, INSERTED.created_at "
                "VALUES (?, ?, ?, ?)",
                (body.name, body.email, role_upper, allocated),
            )
            row = cur.fetchone()
            conn.commit()
            return {
                "id": row[0],
                "name": body.name,
                "email": body.email,
                "role": role_upper,
                "allocated_plants": allocated,
                "created_at": row[1].isoformat() if row[1] else None,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.put("/{id}", dependencies=[Depends(require_admin)])
def update_email_recipient(id: int, body: EmailRecipientUpdate):
    role_upper = body.role.upper()
    if role_upper not in ("MANAGER", "DIRECTOR"):
        raise HTTPException(status_code=400, detail="Role must be MANAGER or DIRECTOR")
        
    allocated = body.allocated_plants if role_upper == "MANAGER" else None
    
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            # Check exist
            cur.execute("SELECT COUNT(*) FROM dbo.EmailRecipients WHERE id = ?", (id,))
            if cur.fetchone()[0] == 0:
                raise HTTPException(status_code=404, detail="Recipient not found")
                
            # Check unique email on other recipients
            cur.execute("SELECT COUNT(*) FROM dbo.EmailRecipients WHERE email = ? AND id <> ?", (body.email, id))
            if cur.fetchone()[0] > 0:
                raise HTTPException(status_code=409, detail="Email already used by another recipient")
                
            cur.execute(
                "UPDATE dbo.EmailRecipients "
                "SET name = ?, email = ?, role = ?, allocated_plants = ? "
                "WHERE id = ?",
                (body.name, body.email, role_upper, allocated, id),
            )
            conn.commit()
            return {
                "id": id,
                "name": body.name,
                "email": body.email,
                "role": role_upper,
                "allocated_plants": allocated,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/{id}", dependencies=[Depends(require_admin)])
def delete_email_recipient(id: int):
    try:
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM dbo.EmailRecipients WHERE id = ?", (id,))
            if cur.fetchone()[0] == 0:
                raise HTTPException(status_code=404, detail="Recipient not found")
                
            cur.execute("DELETE FROM dbo.EmailRecipients WHERE id = ?", (id,))
            conn.commit()
            return {"status": "ok", "message": f"Recipient id {id} deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
