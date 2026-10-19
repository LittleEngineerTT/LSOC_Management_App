import threading
import time

from fastapi.testclient import TestClient

from app.core import security
from conftest import PASSWORD


def test_slow_password_checks_run_in_parallel(client: TestClient, monkeypatch) -> None:
    # Simule un Argon2 lent : sans verrou global autour du hachage, deux connexions se chevauchent.
    original = security.verify_password
    active, peak, guard = 0, 0, threading.Lock()

    def slow(value: str, encoded: str | None) -> bool:
        nonlocal active, peak
        with guard:
            active += 1
            peak = max(peak, active)
        time.sleep(0.5)
        with guard:
            active -= 1
        return original(value, encoded)

    monkeypatch.setattr('app.api.auth.verify_password', slow)
    results: list[int] = []

    def attempt() -> None:
        with TestClient(client.app) as other:
            results.append(other.post('/api/v1/auth/login', json={'username': 'admin', 'password': PASSWORD}).status_code)

    threads = [threading.Thread(target=attempt) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert results == [200, 200]
    assert peak == 2


def test_password_changed_during_check_is_refused(client: TestClient, monkeypatch) -> None:
    from app.core.security import hash_password
    from app.persistence.database import SessionFactory
    from app.persistence.models import User

    original = security.verify_password

    def racing(value: str, encoded: str | None) -> bool:
        result = original(value, encoded)
        # Réinitialisation concurrente, validée pendant la vérification du mot de passe.
        with SessionFactory.begin() as db:
            db.get(User, 'admin').password_hash = hash_password('another-password-123')
        return result

    monkeypatch.setattr('app.api.auth.verify_password', racing)
    response = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': PASSWORD})
    assert response.status_code == 401
