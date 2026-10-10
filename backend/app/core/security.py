import base64
import hashlib
import secrets
from datetime import UTC, datetime

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet

from app.core.config import settings

hasher = PasswordHasher()
_dummy_hash = hasher.hash("dummy-password-for-timing")


def now() -> datetime:
    return datetime.now(UTC)


def token() -> str:
    return secrets.token_urlsafe(32)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(value: str) -> str:
    return hasher.hash(value)


def verify_password(value: str, encoded: str | None) -> bool:
    try:
        return hasher.verify(encoded or _dummy_hash, value) and encoded is not None
    except (VerificationError, InvalidHashError):
        return False


def cipher() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest()))
