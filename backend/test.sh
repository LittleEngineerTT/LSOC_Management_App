#!/usr/bin/env bash
# Tests du backend sur une base PostgreSQL jetable, du montage au nettoyage.
#
#   backend/test.sh                     vérification complète, comme la CI (scripts/verify.py)
#   backend/test.sh tests/test_x.py -vv pytest seul, avec ses arguments
#
# La base est un conteneur Docker dédié, recréé à chaque lancement et supprimé à la fin, même
# en cas d’échec ou d’interruption : la base de l’application n’est jamais touchée.
# Variables facultatives : LSOC_TEST_PORT (55432 par défaut), LSOC_TEST_CONTAINER, PYTHON
# (interpréteur 3.12+ pour créer l’environnement, python3.13 par défaut).
set -euo pipefail

BACKEND="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(dirname "$BACKEND")"
CONTAINER="${LSOC_TEST_CONTAINER:-lsoc-test-db}"
PORT="${LSOC_TEST_PORT:-55432}"
VENV="$BACKEND/.venv"
URL="postgresql+psycopg://lsoc:lsoc@localhost:${PORT}/lsoc_test"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

cleanup() {
  step "Suppression de la base de test ($CONTAINER)"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}

# Environnement Python : recréé s’il manque ou si son interpréteur n’existe plus.
if ! "$VENV/bin/python" -c 'import sys; assert sys.version_info >= (3, 12)' >/dev/null 2>&1; then
  step "Création de l’environnement Python ($VENV)"
  rm -rf "$VENV"
  "${PYTHON:-python3.13}" -m venv "$VENV"
  "$VENV/bin/pip" install --quiet -r "$BACKEND/requirements-dev.lock"
  "$VENV/bin/pip" install --quiet --no-deps -e "$BACKEND"
fi

step "Démarrage de la base de test ($CONTAINER, port $PORT)"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
trap cleanup EXIT
docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=lsoc_test -e POSTGRES_USER=lsoc -e POSTGRES_PASSWORD=lsoc \
  -p "127.0.0.1:${PORT}:5432" postgres:16-alpine >/dev/null
for _ in $(seq 60); do
  # Prête quand elle accepte une vraie requête (le serveur redémarre une fois à l’initialisation).
  if docker exec "$CONTAINER" psql -U lsoc -d lsoc_test -c 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" psql -U lsoc -d lsoc_test -c 'SELECT 1' >/dev/null

# Uniquement pour ce script : le terminal garde ses propres variables.
export LSOC_DATABASE_URL="$URL"
export LSOC_TEST_DATABASE_URL="$URL"
export LSOC_TEST_DATABASE_CONFIRMED=yes
export LSOC_ENVIRONMENT=development

if [ "$#" -eq 0 ]; then
  step "Vérification complète (tests, ruff, mypy, serveur réel)"
  cd "$PROJECT"
  "$VENV/bin/python" backend/scripts/verify.py
else
  step "pytest $*"
  cd "$BACKEND"
  mkdir -p .tmp
  TMPDIR="$BACKEND/.tmp" "$VENV/bin/python" -m pytest "$@"
fi
step "Terminé : succès"
