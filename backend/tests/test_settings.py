import pytest
from pydantic import ValidationError

from app.core.config import Settings

SECRET = 'x' * 40


def test_production_is_the_default_and_refuses_the_development_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv('LSOC_ENVIRONMENT', raising=False)
    with pytest.raises(ValidationError, match='LSOC_SECRET_KEY'):
        Settings(_env_file=None)


def test_production_requires_https_and_secure_cookies() -> None:
    with pytest.raises(ValidationError, match='HTTPS'):
        Settings(_env_file=None, environment='production', secret_key=SECRET)
    settings = Settings(
        _env_file=None,
        environment='production',
        secret_key=SECRET,
        cookie_secure=True,
        frontend_url='https://club.example.org',
    )
    assert settings.environment == 'production'


def test_unknown_environment_is_rejected() -> None:
    # Une faute de frappe (« prod ») ne doit pas désactiver silencieusement les contrôles.
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment='prod', secret_key=SECRET)


def test_development_keeps_local_defaults() -> None:
    assert Settings(_env_file=None, environment='development').cookie_secure is False
