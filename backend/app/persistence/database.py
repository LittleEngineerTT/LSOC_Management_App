from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.database_url, pool_pre_ping=True, connect_args={"options": "-c timezone=UTC"}
)
SessionFactory = sessionmaker(engine, expire_on_commit=False)


def session() -> Session:
    return SessionFactory()
