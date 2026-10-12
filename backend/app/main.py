from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api import (
    accounts,
    auth,
    catalog,
    event_requests,
    events,
    ffvb,
    licenses,
    privacy,
    public,
    registrations,
    social,
)
from app.api.common import DB
from app.api.schemas import Status
from app.core.config import settings

app = FastAPI(
    title="LSOC Management API",
    version="1.0.0",
    description="Planning du club, occupation des gymnases et synchronisation FFVB.",
    openapi_tags=[
        {"name": "Authentification"},
        {"name": "Comptes"},
        {"name": "Catalogue"},
        {"name": "Planning"},
        {"name": "Messagerie et suivis"},
        {"name": "FFVB"},
        {"name": "Invités"},
    ],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)


@app.exception_handler(IntegrityError)
def integrity_error(request: Request, error: IntegrityError) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={"detail": "Conflit de données : doublon ou ressource encore utilisée"},
    )


@app.get("/api/v1/health", response_model=Status, tags=["Santé"])
def health(db: DB) -> Status:
    db.execute(text("SELECT 1"))
    return Status(message="ok")


for router in (
    auth.router,
    accounts.router,
    catalog.router,
    events.router,
    event_requests.router,
    registrations.router,
    licenses.router,
    social.router,
    ffvb.router,
    public.router,
    privacy.router,
):
    app.include_router(router, prefix="/api/v1")
