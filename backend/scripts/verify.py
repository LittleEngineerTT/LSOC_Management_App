"""Vérification séquentielle sur une base PostgreSQL dédiée aux tests."""
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
BACKEND = PROJECT / 'backend'
os.chdir(PROJECT)
os.environ.setdefault('LSOC_ENVIRONMENT', 'development')
os.environ['LSOC_DATABASE_URL'] = os.environ.get('LSOC_TEST_DATABASE_URL', 'postgresql+psycopg://lewis@127.0.0.1:55433/postgres')
os.environ['TMPDIR'] = str(BACKEND / '.tmp')
(BACKEND / '.tmp').mkdir(exist_ok=True)

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402
from app.persistence.database import engine  # noqa: E402

if ':55433/' not in str(engine.url) and os.environ.get('LSOC_TEST_DATABASE_CONFIRMED') != 'yes':
    raise SystemExit('Utiliser une base dédiée et LSOC_TEST_DATABASE_CONFIRMED=yes ; le schéma public sera effacé')
with engine.begin() as db:
    db.execute(text('DROP SCHEMA public CASCADE'))
    db.execute(text('CREATE SCHEMA public'))

result = pytest.main(['-c', str(BACKEND / 'pyproject.toml')])
if result:
    raise SystemExit(result)
for command in [
    ['ruff', 'check', 'app', 'migrations'],
    ['ruff', 'format', '--check', 'app', 'migrations'],
    ['mypy', '--config-file', 'pyproject.toml', 'app'],
]:
    subprocess.run([sys.executable, '-m', *command], cwd=BACKEND, check=True)

# Exercise bootstrap without predefined credentials, then a real HTTP listener.
bootstrap_password = secrets.token_urlsafe(24)
bootstrap_env = os.environ.copy()
bootstrap_env['LSOC_ADMIN_PASSWORD'] = bootstrap_password
subprocess.run([sys.executable, '-m', 'app.cli', 'create-admin', '--username', 'bootstrap', '--first-name', 'Bootstrap'], cwd=BACKEND, env=bootstrap_env, check=True)
subprocess.run([sys.executable, '-m', 'app.cli', 'seed-demo', '--admin-username', 'admin'], cwd=BACKEND, check=True)
log_path = BACKEND / '.tmp' / 'api-smoke.log'
with log_path.open('w') as log:
    server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '18000'], cwd=BACKEND, stdout=log, stderr=log)
    try:
        with httpx.Client(base_url='http://127.0.0.1:18000', timeout=2) as client:
            for attempt in range(100):
                try:
                    response = client.get('/api/v1/health')
                    if response.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                if server.poll() is not None:
                    raise RuntimeError('Le serveur HTTP ne démarre pas ; consulter api-smoke.log')
                time.sleep(0.1)
            else:
                raise RuntimeError('Le serveur HTTP ne répond pas')
            bootstrap = client.post('/api/v1/auth/login', json={'username': 'bootstrap', 'password': bootstrap_password})
            assert bootstrap.status_code == 200, bootstrap.text
            login = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'valid-password-12345'})
            assert login.status_code == 200, login.text
            assert client.get('/api/v1/events').status_code == 200
            assert client.get('/openapi.json').json()['info']['version'] == '1.0.0'
            client.headers['X-CSRF-Token'] = login.json()['csrf_token']
            assert client.post('/api/v1/auth/logout').status_code == 204
            assert client.get('/api/v1/events').status_code == 401
            print('Vérification HTTP réelle et commande seed-demo : OK')
    finally:
        server.terminate()
        server.wait(timeout=10)
