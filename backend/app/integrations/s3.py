"""Client S3 minimal : dépôt et suppression d’objets signés en SigV4, au-dessus de httpx.

Le bucket est en lecture publique : le navigateur lit les PDF directement à leur URL, dont le
nom aléatoire de 64 caractères fait office de secret. Les tests remplacent `transport` par un
S3 simulé.
"""

import hashlib
import hmac
import logging
import re
from datetime import UTC, datetime
from urllib.parse import quote, urlsplit

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

# Remplacé dans les tests (httpx.MockTransport) ; None : réseau réel.
transport: httpx.BaseTransport | None = None


class StorageError(RuntimeError):
    pass


def configured() -> bool:
    return bool(settings.s3_bucket)


def object_url(key: str) -> str:
    if settings.s3_endpoint_url:
        return f"{settings.s3_endpoint_url.rstrip('/')}/{settings.s3_bucket}/{quote(key)}"
    return f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com/{quote(key)}"


def public_url(key: str) -> str:
    base = settings.s3_public_url.rstrip("/")
    return f"{base}/{quote(key)}" if base else object_url(key)


def _hmac(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


def signed_headers(
    method: str, url: str, body: bytes, extra: dict[str, str], at: datetime | None = None
) -> dict[str, str]:
    """En-têtes d’une requête signée AWS Signature Version 4 (sans paramètres de requête)."""
    parts = urlsplit(url)
    stamp = (at or datetime.now(UTC)).astimezone(UTC)
    amz_date, day = stamp.strftime("%Y%m%dT%H%M%SZ"), stamp.strftime("%Y%m%d")
    payload = hashlib.sha256(body).hexdigest()
    headers = {
        "host": parts.netloc,
        "x-amz-content-sha256": payload,
        "x-amz-date": amz_date,
        **{name.lower(): value for name, value in extra.items()},
    }
    names = sorted(headers)
    canonical = "\n".join(
        [
            method,
            parts.path or "/",
            "",
            *(f"{name}:{headers[name].strip()}" for name in names),
            "",
            ";".join(names),
            payload,
        ]
    )
    scope = f"{day}/{settings.s3_region}/s3/aws4_request"
    to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
    )
    key = _hmac(f"AWS4{settings.s3_secret_key}".encode(), day)
    for part in (settings.s3_region, "s3", "aws4_request"):
        key = _hmac(key, part)
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    headers["authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={settings.s3_access_key}/{scope}, "
        f"SignedHeaders={';'.join(names)}, Signature={signature}"
    )
    # httpx envoie lui-même l’en-tête Host, avec la même valeur.
    del headers["host"]
    return headers


def _send(
    method: str, key: str, body: bytes = b"", extra: dict[str, str] | None = None
) -> tuple[int, str]:
    """Statut HTTP et code d’erreur S3 (« NoSuchBucket »…), vide en cas de succès."""
    if not configured():
        raise StorageError("Stockage des licences non configuré")
    url = object_url(key)
    try:
        with httpx.Client(transport=transport, timeout=20) as client:
            response = client.request(
                method, url, content=body, headers=signed_headers(method, url, body, extra or {})
            )
    except httpx.HTTPError as error:
        raise StorageError("Stockage des licences injoignable") from error
    code = re.search(r"<Code>([^<]+)</Code>", response.text) if response.is_error else None
    return response.status_code, code.group(1) if code else ""


def refused(action: str, status: int, code: str) -> StorageError:
    if code == "NoSuchBucket":
        return StorageError(f"Bucket « {settings.s3_bucket} » introuvable dans le stockage")
    return StorageError(f"{action} refusé par le stockage ({status}{f' {code}' if code else ''})")


def put(key: str, body: bytes, content_type: str) -> None:
    status, code = _send(
        "PUT",
        key,
        body,
        {"content-type": content_type, "content-disposition": 'inline; filename="licence.pdf"'},
    )
    if not 200 <= status < 300:
        raise refused("Dépôt", status, code)


def delete(key: str) -> None:
    status, code = _send("DELETE", key)
    if not 200 <= status < 300 and code != "NoSuchKey":
        raise refused("Suppression", status, code)


def discard(key: str | None) -> None:
    """Suppression sans échec : un objet orphelin reste illisible sans son URL."""
    if not key:
        return
    try:
        delete(key)
    except StorageError:
        log.warning("Objet de licence non supprimé : %s", key[:12], exc_info=True)
