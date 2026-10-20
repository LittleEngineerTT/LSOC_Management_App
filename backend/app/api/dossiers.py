import secrets
from typing import Annotated, Literal
from urllib.parse import quote, unquote

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.common import DB, Actor, Admin, coached_teams, get
from app.api.schemas import (
    DocumentDecisionInput,
    DossierDocumentView,
    DossierInput,
    DossierView,
    RequestedDocument,
)
from app.core.security import cipher, now
from app.integrations import s3
from app.persistence.models import Assignment, Dossier, DossierDocument, User
from app.services.notifications import admins, notify

router = APIRouter(tags=["Dossiers d’inscription"])

LABELS = {
    "medical_certificate": "Certificat médical",
    "identity": "Carte d’identité ou passeport",
    "reduction_proof": "Justificatif de réduction",
}


def piece(item: DossierDocument | RequestedDocument) -> str:
    """Nom d’une pièce : le libellé choisi pour une pièce « Autre »."""
    return item.label if item.kind == "other" else LABELS[item.kind]


LINK = "/app/inscriptions"
MAX_FILE_BYTES = 10 * 1024 * 1024
# Formats acceptés et leur signature : un QR code ou un code se dépose en image ou en PDF.
SIGNATURES = {
    "application/pdf": b"%PDF-",
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
}


def check_scope(db: Session, actor: User, user_id: str) -> None:
    """Un coach n’agit que sur les joueurs de ses équipes ; un adhérent sur aucun."""
    allowed = coached_teams(db, actor)
    if allowed is None:
        return
    teams = db.scalars(
        select(Assignment.team_id).where(Assignment.user_id == user_id, Assignment.kind == "player")
    )
    if not allowed & set(teams):
        raise HTTPException(403, "Joueur hors de vos équipes")


def view(db: Session, value: Dossier) -> DossierView:
    documents = db.scalars(
        select(DossierDocument)
        .where(DossierDocument.dossier_id == value.id)
        .order_by(DossierDocument.kind, DossierDocument.label)
    )
    return DossierView.model_validate(
        {
            "id": value.id,
            "user_id": value.user_id,
            "first_name": get(db, User, value.user_id).first_name,
            "opened_by": value.opened_by,
            "note": value.note,
            "payment_requested": value.payment_requested,
            "payment_validated_at": value.payment_validated_at,
            "created_at": value.created_at,
            "closed_at": value.closed_at,
            "documents": [
                DossierDocumentView.model_validate(
                    {
                        "id": item.id,
                        "kind": item.kind,
                        "label": item.label,
                        "status": item.status,
                        "file_name": item.file_name,
                        "uploaded_at": item.uploaded_at,
                        "decision": item.decision,
                        "has_file": item.file_key is not None,
                    }
                )
                for item in documents
            ],
        }
    )


def locked(db: Session, dossier_id: str) -> Dossier:
    value = db.scalar(select(Dossier).where(Dossier.id == dossier_id).with_for_update())
    if value is None:
        raise HTTPException(404, "Dossier introuvable")
    if value.closed_at is not None:
        raise HTTPException(409, "Dossier clos")
    return value


def document(db: Session, value: Dossier, document_id: str) -> DossierDocument:
    item = db.get(DossierDocument, document_id)
    if item is None or item.dossier_id != value.id:
        raise HTTPException(404, "Pièce non demandée dans ce dossier")
    return item


def steps(documents: list[RequestedDocument], payment: bool) -> str:
    return "\n".join(
        [f"- {piece(item)}" for item in documents]
        + (["- Paiement, à régler auprès du club"] if payment else [])
    )


def request_documents(
    db: Session,
    actor: User,
    user: User,
    documents: list[RequestedDocument],
    payment: bool,
    note: str = "",
) -> Dossier:
    """Ouvre le dossier du joueur, ou complète celui en cours, et le prévient.

    Une pièce déjà demandée dans le dossier en cours n’est pas ajoutée une seconde fois.
    """
    for item in documents:
        if (item.kind == "other") != bool(item.label.strip()):
            raise HTTPException(422, "Nommez chaque pièce « Autre », et seulement celles-là")
    if not user.active:
        raise HTTPException(409, "Compte inactif")
    # Verrou du joueur : deux demandes simultanées n’ouvrent pas deux dossiers.
    db.scalar(select(User.id).where(User.id == user.id).with_for_update())
    value = db.scalar(
        select(Dossier).where(Dossier.user_id == user.id, Dossier.closed_at.is_(None))
    )
    opened = value is None
    if value is None:
        value = Dossier(user_id=user.id, opened_by=actor.id, note=note)
        db.add(value)
        db.flush()
    present = {
        (item.kind, item.label)
        for item in db.scalars(
            select(DossierDocument).where(DossierDocument.dossier_id == value.id)
        )
    }
    added: list[RequestedDocument] = []
    for item in documents:
        key = (item.kind, item.label.strip())
        if key in present:
            continue
        present.add(key)
        added.append(RequestedDocument(kind=item.kind, label=key[1]))
        db.add(DossierDocument(dossier_id=value.id, kind=item.kind, label=key[1]))
    payment = payment and not value.payment_requested
    if not added and not payment:
        raise HTTPException(422, "Aucune nouvelle pièce ni paiement à demander")
    value.payment_requested = value.payment_requested or payment
    db.flush()
    text = steps(added, payment) + (f"\n\n{note}" if note else "")
    title = (
        "Dossier d’inscription : des pièces vous sont demandées"
        if opened
        else "Dossier d’inscription : nouvelle demande"
    )
    player_alert(db, value, title, text)
    return value


def staff_alert(db: Session, value: Dossier, title: str) -> None:
    """Prévient les administrateurs et le coach qui a ouvert le dossier."""
    key = f"dossier:{value.id}:{secrets.token_hex(8)}"
    admins(db, key, "dossier", title, link=LINK)
    opener = db.get(User, value.opened_by) if value.opened_by else None
    if opener is not None and "admin" not in opener.roles:
        notify(db, opener, key, "dossier", title, send_email=opener.referent_email, link=LINK)


def player_alert(db: Session, value: Dossier, title: str, body: str = "") -> None:
    user = get(db, User, value.user_id)
    key = f"dossier:{value.id}:{secrets.token_hex(8)}"
    notify(db, user, key, "dossier", title, body=body, link=LINK)


@router.get("/dossiers", response_model=list[DossierView])
def dossiers(
    db: DB, actor: Actor, state: Literal["open", "closed", "all"] = "open"
) -> list[DossierView]:
    """Dossiers des joueurs du périmètre : tout le club pour un administrateur."""
    allowed = coached_teams(db, actor)
    query = select(Dossier).order_by(Dossier.created_at.desc(), Dossier.id)
    if state != "all":
        query = query.where(
            Dossier.closed_at.is_(None) if state == "open" else Dossier.closed_at.is_not(None)
        )
    if allowed is not None:
        players = select(Assignment.user_id).where(
            Assignment.team_id.in_(allowed), Assignment.kind == "player"
        )
        query = query.where(Dossier.user_id.in_(players))
    return [view(db, value) for value in db.scalars(query)]


@router.get("/dossiers/me", response_model=DossierView | None)
def mine(db: DB, actor: Actor) -> DossierView | None:
    """Dossier ouvert du joueur ; sans dossier, l’application Inscriptions lui reste fermée."""
    value = db.scalar(
        select(Dossier).where(Dossier.user_id == actor.id, Dossier.closed_at.is_(None))
    )
    return view(db, value) if value else None


@router.post("/dossiers", response_model=DossierView, status_code=201)
def open_dossier(body: DossierInput, db: DB, actor: Admin) -> DossierView:
    """Demande des pièces ou un paiement à un joueur ; chaque étape est facultative.

    Réservé aux administrateurs : un coach passe par une demande (POST /requests).
    """
    user = get(db, User, body.user_id)
    return view(db, request_documents(db, actor, user, body.documents, body.payment, body.note))


async def upload_body(request: Request, actor: Actor) -> tuple[bytes, str, str]:
    """Fichier brut lu seulement après le contrôle de la session : 10 Mo au plus."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type not in SIGNATURES:
        raise HTTPException(415, "Déposez un fichier PDF, JPEG ou PNG")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_FILE_BYTES:
        raise HTTPException(413, "Le fichier dépasse 10 Mo")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_FILE_BYTES:
            raise HTTPException(413, "Le fichier dépasse 10 Mo")
    if not body.startswith(SIGNATURES[content_type]):
        raise HTTPException(415, "Le contenu ne correspond pas au format annoncé")
    name = unquote(request.headers.get("x-file-name", "")).strip()[:200] or "piece"
    return bytes(body), content_type, name


@router.put(
    "/dossiers/{dossier_id}/documents/{document_id}/file",
    response_model=DossierView,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                kind: {"schema": {"type": "string", "format": "binary"}} for kind in SIGNATURES
            },
        }
    },
)
def upload(
    dossier_id: str,
    document_id: str,
    actor: Actor,
    received: Annotated[tuple[bytes, str, str], Depends(upload_body)],
    tasks: BackgroundTasks,
    db: DB,
) -> DossierView:
    """Dépôt d’une pièce par le joueur ; elle est chiffrée avant d’entrer dans le stockage."""
    if not s3.configured():
        raise HTTPException(503, "Stockage des fichiers non configuré")
    value = locked(db, dossier_id)
    if value.user_id != actor.id:
        raise HTTPException(403, "Seul le joueur dépose les pièces de son dossier")
    item = document(db, value, document_id)
    if item.status == "validated":
        raise HTTPException(409, "Pièce déjà validée")
    content, content_type, name = received
    key = f"dossiers/{secrets.token_hex(32)}"
    try:
        s3.put(key, cipher().encrypt(content), "application/octet-stream", "attachment")
    except s3.StorageError as error:
        raise HTTPException(502, str(error)) from error
    previous = item.file_key
    item.file_key, item.file_name, item.content_type = key, name, content_type
    item.uploaded_at, item.status, item.decision = now(), "submitted", ""
    db.flush()
    # L’ancien fichier disparaît après la validation de la transaction.
    tasks.add_task(s3.discard, previous)
    staff_alert(db, value, f"Pièce déposée par {actor.first_name} : {piece(item)}")
    return view(db, value)


@router.get("/dossiers/{dossier_id}/documents/{document_id}/file")
def download(dossier_id: str, document_id: str, db: DB, actor: Actor) -> Response:
    """Pièce déchiffrée, pour un administrateur ou le joueur lui-même ; jamais pour un coach."""
    value = db.get(Dossier, dossier_id)
    if value is None:
        raise HTTPException(404, "Dossier introuvable")
    if "admin" not in actor.roles and value.user_id != actor.id:
        raise HTTPException(403, "Pièces réservées aux administrateurs")
    item = document(db, value, document_id)
    if item.file_key is None:
        raise HTTPException(404, "Aucun fichier pour cette pièce")
    try:
        content = cipher().decrypt(s3.get(item.file_key))
    except s3.StorageError as error:
        raise HTTPException(502, str(error)) from error
    except InvalidToken as error:
        raise HTTPException(500, "Fichier illisible avec la clé actuelle") from error
    name = quote(item.file_name or "piece")
    return Response(
        content,
        media_type=item.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{name}",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/dossiers/{dossier_id}/documents/{document_id}/decision", response_model=DossierView)
def decide(
    dossier_id: str, document_id: str, body: DocumentDecisionInput, db: DB, actor: Admin
) -> DossierView:
    value = locked(db, dossier_id)
    item = document(db, value, document_id)
    if item.status != "submitted":
        raise HTTPException(409, "Aucune pièce déposée à valider")
    item.status = "validated" if body.accept else "rejected"
    item.decision = body.reason
    db.flush()
    player_alert(
        db,
        value,
        f"{piece(item)} : {'validé' if body.accept else 'à déposer de nouveau'}",
        body.reason,
    )
    return view(db, value)


@router.post("/dossiers/{dossier_id}/payment", response_model=DossierView)
def validate_payment(dossier_id: str, db: DB, actor: Admin) -> DossierView:
    """Le paiement se règle hors de la plateforme ; l’administrateur en valide la réception."""
    value = locked(db, dossier_id)
    if not value.payment_requested:
        raise HTTPException(409, "Aucun paiement demandé dans ce dossier")
    if value.payment_validated_at is None:
        value.payment_validated_at = now()
        db.flush()
        player_alert(db, value, "Dossier d’inscription : paiement reçu")
    return view(db, value)


@router.post("/dossiers/{dossier_id}/close", response_model=DossierView)
def close(dossier_id: str, tasks: BackgroundTasks, db: DB, actor: Admin) -> DossierView:
    """Clôt le dossier et efface ses fichiers ; seul l’état des pièces est conservé."""
    value = locked(db, dossier_id)
    for item in db.scalars(select(DossierDocument).where(DossierDocument.dossier_id == value.id)):
        tasks.add_task(s3.discard, item.file_key)
        item.file_key = None
    value.closed_at = now()
    db.flush()
    player_alert(db, value, "Dossier d’inscription clos")
    return view(db, value)
