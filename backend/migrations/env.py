from alembic import context
from sqlalchemy import create_engine, pool, text

from app.core.config import settings
from app.persistence.models import Base

if context.is_offline_mode():
    context.configure(
        url=settings.database_url,
        target_metadata=Base.metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(
        settings.database_url, poolclass=pool.NullPool, connect_args={"options": "-c timezone=UTC"}
    )
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
        with context.begin_transaction():
            # Plusieurs conteneurs peuvent migrer en même temps (déploiement, redémarrage) :
            # le verrou les sérialise, le suivant constate que la base est déjà à jour.
            connection.execute(text("SELECT pg_advisory_xact_lock(781014)"))
            context.run_migrations()
