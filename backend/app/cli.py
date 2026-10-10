import argparse
import getpass
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select, text

from app.api.schemas import EmailInput, EventInput, PasswordInput, UsernameInput
from app.core.config import settings
from app.core.security import hash_password
from app.persistence.database import SessionFactory
from app.persistence.models import FFVBSource, GymMapping, Gymnasium, Section, Team, User
from app.services.events import create_event


def main() -> None:
    parser = argparse.ArgumentParser(description="Administration locale du backend LSOC")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-admin", help="Créer un administrateur actif")
    create.add_argument("--username", required=True)
    create.add_argument("--email", help="Adresse facultative pour les notifications")
    create.add_argument("--first-name", required=True)
    create.add_argument(
        "--password-env",
        default="LSOC_ADMIN_PASSWORD",
        help="Variable contenant le mot de passe ; sinon saisie masquée",
    )
    demo = commands.add_parser(
        "seed-demo", help="Ajouter des données facultatives de démonstration"
    )
    demo.add_argument("--admin-username", required=True)
    export = commands.add_parser("export-openapi", help="Exporter les contrats pour le frontend")
    export.add_argument("--output", default="openapi.json")
    args = parser.parse_args()
    if args.command == "export-openapi":
        from app.main import app

        Path(args.output).write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n")
        print("Contrats OpenAPI exportés")
        return
    username = UsernameInput(
        username=args.username if args.command == "create-admin" else args.admin_username
    ).username
    with SessionFactory.begin() as db:
        db.execute(text("SELECT pg_advisory_xact_lock(781010)"))
        db.execute(text("SELECT pg_advisory_xact_lock(781013)"))
        if args.command == "create-admin":
            if db.scalar(select(User.id).where(User.username == username)):
                parser.error("Cet identifiant est déjà utilisé")
            password = os.environ.get(args.password_env) or getpass.getpass(
                "Mot de passe (12 caractères minimum) : "
            )
            validated = PasswordInput(password=password)
            if not 1 <= len(args.first_name.strip()) <= 80:
                parser.error("Le prénom doit contenir entre 1 et 80 caractères")
            user = User(
                first_name=args.first_name.strip(),
                category="adult",
                roles=["admin"],
                username=username,
                email=str(EmailInput(email=args.email).email).lower() if args.email else None,
                password_hash=hash_password(validated.password),
                active=True,
            )
            db.add(user)
            db.flush()
            print(f"Administrateur créé : {user.id}")
            return
        admin = db.scalar(select(User).where(User.username == username, User.active.is_(True)))
        if admin is None or "admin" not in admin.roles:
            parser.error("Un administrateur actif est requis")
        if db.scalar(select(Section.id).where(Section.name == "Démonstration — Loisir")):
            print("Les données de démonstration existent déjà")
            return
        section = Section(name="Démonstration — Loisir")
        gym = Gymnasium(name="Démonstration — Gymnase", capacity=3)
        db.add_all([section, gym])
        db.flush()
        team = Team(name="LSO COLOMBES", section_id=section.id, referent_id=admin.id)
        db.add(team)
        db.flush()
        source = FFVBSource(
            team_id=team.id,
            season="2026/2027",
            entity="PTIDF92",
            pool="BRC",
            team_number="6",
            team_name="LSO COLOMBES",
            club_code="0926620",
            enabled=False,
            interval_minutes=settings.ffvb_interval_minutes,
        )
        db.add(source)
        db.add(GymMapping(official_name="GYMNASE AMBROISE PARE", gymnasium_id=gym.id))
        start = (datetime.now(UTC) + timedelta(days=1)).replace(
            hour=18, minute=0, second=0, microsecond=0
        )
        create_event(
            db,
            EventInput(
                title="Démonstration — Entraînement",
                kind="training",
                section_ids=[section.id],
                gymnasium_id=gym.id,
                starts_at=start,
                ends_at=start + timedelta(hours=2),
                courts=2,
                referent_id=admin.id,
            ),
            admin,
        )
        print(
            "Données de démonstration ajoutées ; source FFVB désactivée jusqu’à configuration explicite"
        )


if __name__ == "__main__":
    main()
