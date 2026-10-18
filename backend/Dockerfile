FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY pyproject.toml alembic.ini ./
COPY app ./app
COPY migrations ./migrations
# UID numérique fixe : Kubernetes vérifie runAsNonRoot sans résoudre les noms d'utilisateur.
RUN pip install --no-cache-dir --no-deps . \
    && python -m compileall -q app migrations \
    && useradd --uid 10001 --user-group --create-home lsoc
USER 10001
EXPOSE 8000
# Derrière un proxy, définir FORWARDED_ALLOW_IPS pour que l'adresse du client (limitation des
# tentatives de connexion) soit lue dans X-Forwarded-For plutôt que celle du proxy.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
