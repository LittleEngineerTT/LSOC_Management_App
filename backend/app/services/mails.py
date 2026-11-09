"""Mise en forme des e-mails : gabarit commun, fiches d’événement et modifications.

Chaque e-mail part en deux versions, texte et HTML, faites des mêmes blocs. Il se termine par
un bouton qui ouvre l’application sur l’écran où la notification se traite, après connexion
s’il le faut.
"""

from dataclasses import dataclass
from datetime import datetime
from html import escape
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.api.schemas import EventView
from app.core.config import settings
from app.persistence.models import Event, Gymnasium, Position, Section, Team, User

PARIS = ZoneInfo("Europe/Paris")
DAYS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
MONTHS = (
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
)
KINDS = {"training": "Entraînement", "match": "Match", "other": "Autre"}

# Couleurs de l’application ; les styles sont en ligne, seuls lus par toutes les messageries.
NAVY = "#142c40"
RED = "#d94040"
# Conflit : orange de l’application, lisible en texte blanc.
ORANGE = "#b85c00"
MUTED = "#64717b"
BORDER = "#dde3e8"
PAGE = "#eef2f5"
HIGHLIGHT = "#fff4d6"
MARK = "#e0a100"
FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;"


@dataclass
class Block:
    """Morceau d’e-mail, en texte et en HTML."""

    text: str
    html: str


def join(blocks: list[Block]) -> Block:
    return Block(
        "\n\n".join(block.text for block in blocks if block.text),
        "".join(block.html for block in blocks),
    )


def app_url(path: str) -> str:
    """Lien qui ouvre l’application sur `path`, en passant par la connexion s’il le faut."""
    return f"{settings.frontend_url}/login?suite={quote(path, safe='/')}"


def event_path(event: Event) -> str:
    """Écran d’un événement : le planning sur sa semaine, avec l’événement ouvert."""
    day = event.starts_at.astimezone(PARIS).date().isoformat()
    return f"/app/planning?semaine={day}&event={event.id}"


def action_label(path: str) -> str:
    """Libellé du bouton, d’après l’écran où il mène (comme dans les notifications)."""
    if "tab=requests" in path:
        return "Examiner la demande"
    if path.startswith("/app/messagerie"):
        return "Voir le message"
    if "event=" in path:
        return "Voir l’événement"
    if path.startswith("/app/administration"):
        return "Traiter dans l’administration"
    if path.startswith("/app/gymnases") or "onglet=gymnases" in path:
        return "Voir les gymnases"
    # « Mon planning » est devenu un filtre du Planning (?mon=1) ; l’ancienne adresse y mène.
    if path.startswith("/app/mon-planning") or "mon=1" in path:
        return "Voir mon planning"
    if path.startswith("/app/planning"):
        return "Voir le planning"
    if path.startswith("/app/inscriptions"):
        return "Voir les demandes"
    return "Ouvrir l’application"


def text_html(value: str) -> str:
    """Texte saisi en HTML : une ligne vide sépare les paragraphes."""
    paragraphs = [part.strip() for part in value.split("\n\n") if part.strip()]
    return "".join(
        f'<p style="margin:0 0 12px;{FONT}font-size:15px;line-height:1.5;color:{NAVY};">'
        f"{escape(part).replace(chr(10), '<br>')}</p>"
        for part in paragraphs
    )


# Événements


def state(event: Event) -> dict[str, Any]:
    """Instantané d’un événement, au format de l’historique des révisions."""
    return EventView.model_validate(event).model_dump(mode="json")


def moment(value: Any) -> datetime | None:
    return datetime.fromisoformat(value).astimezone(PARIS) if isinstance(value, str) else None


def day_label(value: datetime) -> str:
    day = "1er" if value.day == 1 else str(value.day)
    return f"{DAYS[value.weekday()]} {day} {MONTHS[value.month - 1]} {value.year}"


def hour_label(value: datetime) -> str:
    return f"{value.hour} h {value.minute:02d}"


def person(user: User) -> str:
    return f"{user.first_name} {user.last_initial}." if user.last_initial else user.first_name


def reserved(db: Session, quotas: list[dict[str, Any]]) -> list[str]:
    """« 2 Libéro ou Passeur (Seniors F) » pour chaque lot de places réservées."""
    result: list[str] = []
    for quota in quotas:
        section = db.get(Section, quota["section_id"])
        positions = sorted(
            position.name
            for position in (db.get(Position, item) for item in quota["position_ids"])
            if position
        )
        place = section.name if section else "section supprimée"
        result.append(f"{quota['limit']} {' ou '.join(positions)} ({place})")
    return result


def facts(db: Session, data: dict[str, Any]) -> dict[str, str]:
    """Informations lisibles d’un instantané d’événement, dans l’ordre d’affichage.

    Une valeur vide n’est pas affichée ; avant et après une modification ont les mêmes clés.
    """
    start, end, kickoff = (moment(data.get(key)) for key in ("starts_at", "ends_at", "kickoff_at"))
    gym = db.get(Gymnasium, data["gymnasium_id"]) if data.get("gymnasium_id") else None
    teams = [db.get(Team, identifier) for identifier in data.get("team_ids") or []]
    sections = [db.get(Section, identifier) for identifier in data.get("section_ids") or []]
    referents = [db.get(User, identifier) for identifier in data.get("referent_ids") or []]
    limit = data.get("registration_limit")
    result = {"Titre": str(data.get("title") or ""), "Statut": "Prévu"}
    if data.get("cancelled"):
        result["Statut"] = "Annulé"
    elif data.get("conflict"):
        result["Statut"] = "Conflit"
    result["Date"] = ""
    if start and end:
        result["Date"] = (
            day_label(start)
            if start.date() == end.date()
            else f"du {day_label(start)} au {day_label(end)}"
        )
    # Un match se donne par son coup d’envoi ; son créneau réserve aussi l’échauffement.
    result["Coup d’envoi"] = hour_label(kickoff) if kickoff else ""
    slot = f"{hour_label(start)} – {hour_label(end)}" if start and end else ""
    result["Créneau réservé" if kickoff else "Horaire"] = slot
    result["Lieu"] = gym.name if gym else str(data.get("location") or "") or "À définir"
    result["Type"] = KINDS.get(str(data.get("kind")), "Autre")
    result["Équipes"] = ", ".join(sorted(team.name for team in teams if team))
    result["Sections"] = ", ".join(sorted(section.name for section in sections if section))
    result["Référents"] = ", ".join(person(user) for user in referents if user)
    result["Terrains"] = str(data.get("courts") or "") if gym else ""
    result["Places"] = f"{limit} places" if limit else ""
    result["Places réservées"] = " ; ".join(reserved(db, data.get("registration_quotas") or []))
    result["Description"] = str(data.get("description") or "").strip()
    return result


LABEL = (
    f"padding:9px 12px;vertical-align:top;width:34%;{FONT}font-size:13px;color:{MUTED};"
    f"border-top:1px solid {BORDER};"
)
VALUE = (
    f"padding:9px 12px;vertical-align:top;{FONT}font-size:14px;line-height:1.45;color:{NAVY};"
    f"border-top:1px solid {BORDER};"
)


def badge(label: str, color: str) -> str:
    return (
        f'<span style="display:inline-block;margin:6px 6px 0 0;padding:2px 8px;'
        f"border-radius:10px;background:{color};color:#fff;{FONT}font-size:12px;"
        f'font-weight:bold;">{escape(label)}</span>'
    )


def frame(heading: str, rows: str) -> str:
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border-collapse:separate;border:1px solid {BORDER};border-radius:8px;'
        f'margin:0 0 16px;">'
        f'<tr><td colspan="3" style="padding:12px;background:#f6f8fa;border-radius:8px 8px 0 0;">'
        f"{heading}</td></tr>{rows}</table>"
    )


def title_html(title: str, badges: str) -> str:
    return (
        f'<div style="{FONT}font-size:16px;font-weight:bold;color:{NAVY};">{escape(title)}</div>'
        f"{badges}"
    )


def event_card(db: Session, data: dict[str, Any]) -> Block:
    """Fiche d’un événement : date, horaire, lieu, équipes…"""
    info = facts(db, data)
    title = info["Titre"] or "Événement"
    cancelled = info["Statut"] == "Annulé"
    conflict = info["Statut"] == "Conflit"
    rows = [(key, value) for key, value in info.items() if value and key not in {"Titre", "Statut"}]
    badges = badge(info["Type"], NAVY) + (badge("Annulé", RED) if cancelled else "")
    badges += badge("Conflit", ORANGE) if conflict else ""
    html = frame(
        title_html(title, badges),
        "".join(
            f'<tr><td style="{LABEL}">{escape(key)}</td>'
            f'<td colspan="2" style="{VALUE}">{escape(value).replace(chr(10), "<br>")}</td></tr>'
            for key, value in rows
        ),
    )
    text = "\n".join(
        [
            f"{title}{' (annulé)' if cancelled else ' (conflit)' if conflict else ''}",
            *(f"  {key} : {value}" for key, value in rows),
        ]
    )
    return Block(text, html)


def event_changes(db: Session, before: dict[str, Any], after: dict[str, Any], author: str) -> Block:
    """L’événement avant et après une modification, les informations changées en évidence."""
    old, new = facts(db, before), facts(db, after)
    # Un horaire devient « créneau réservé » quand un coup d’envoi apparaît : les deux restent.
    keys = list(dict.fromkeys([*new, *old]))
    old = {key: old.get(key, "") for key in keys}
    new = {key: new.get(key, "") for key in keys}
    changed = [key for key in keys if old[key] != new[key]]
    if not changed:
        # Seuls des réglages internes ont changé : la fiche suffit.
        return event_card(db, after)
    # Titre et statut ne s’affichent que s’ils changent ; les informations vides des deux
    # côtés sont omises.
    shown = [
        key
        for key in keys
        if key in changed or (key not in {"Titre", "Statut"} and (old[key] or new[key]))
    ]
    intro = f"Modifié par {author} : {', '.join(key.lower() for key in changed)}."
    title = new["Titre"] or "Événement"
    badges = badge(new["Type"], NAVY) + (badge("Annulé", RED) if new["Statut"] == "Annulé" else "")
    badges += badge("Conflit", ORANGE) if new["Statut"] == "Conflit" else ""
    head = (
        f'<tr><td style="{LABEL}border-top:0;padding-top:0;"></td>'
        f'<td style="{LABEL}border-top:0;padding-top:0;font-weight:bold;">Avant</td>'
        f'<td style="{LABEL}border-top:0;padding-top:0;font-weight:bold;">Après</td></tr>'
    )

    def cell(value: str) -> str:
        return escape(value or "—").replace("\n", "<br>")

    rows = []
    for key in shown:
        if key in changed:
            rows.append(
                f'<tr style="background:{HIGHLIGHT};">'
                f'<td style="{LABEL}border-left:4px solid {MARK};color:{NAVY};font-weight:bold;">'
                f"{escape(key)}</td>"
                f'<td style="{VALUE}color:{MUTED};text-decoration:line-through;">'
                f"{cell(old[key])}</td>"
                f'<td style="{VALUE}font-weight:bold;">{cell(new[key])}</td></tr>'
            )
        else:
            rows.append(
                f'<tr><td style="{LABEL}border-left:4px solid transparent;">{escape(key)}</td>'
                f'<td colspan="2" style="{VALUE}">{cell(new[key])}</td></tr>'
            )
    html = (
        f'<p style="margin:0 0 12px;{FONT}font-size:15px;line-height:1.5;color:{NAVY};">'
        f"{escape(intro)}</p>" + frame(title_html(title, badges), head + "".join(rows))
    )
    text = "\n".join(
        [
            intro,
            "",
            title,
            "Ce qui change :",
            *(f"  {key} : {old[key] or '—'} → {new[key] or '—'}" for key in changed),
            *(
                ["Sans changement :"]
                + [f"  {key} : {new[key] or '—'}" for key in shown if key not in changed]
                if len(shown) > len(changed)
                else []
            ),
        ]
    )
    return Block(text, html)


# Gabarit


def button(path: str) -> Block:
    url = app_url(path)
    label = action_label(path)
    html = (
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">'
        f'<tr><td style="border-radius:6px;background:{NAVY};">'
        f'<a href="{escape(url)}" style="display:inline-block;padding:12px 22px;{FONT}'
        f'font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">'
        f"{escape(label)} →</a></td></tr></table>"
        f'<p style="margin:8px 0 0;{FONT}font-size:12px;color:{MUTED};word-break:break-all;">'
        f'Ou copiez ce lien : <a href="{escape(url)}" style="color:{MUTED};">{escape(url)}</a></p>'
    )
    return Block(f"{label} : {url}", html)


def item_link(path: str) -> Block:
    """Lien discret d’un élément d’un e-mail groupé."""
    url = app_url(path)
    label = action_label(path)
    return Block(
        f"{label} : {url}",
        f'<p style="margin:-4px 0 0;{FONT}font-size:14px;">'
        f'<a href="{escape(url)}" style="color:{NAVY};font-weight:bold;">{escape(label)} →</a></p>',
    )


def heading(title: str, level: int = 1) -> Block:
    """Titre de l’e-mail (niveau 1) ou d’un élément d’un e-mail groupé (niveau 2)."""
    size = 20 if level == 1 else 16
    return Block(
        title,
        f'<h{level} style="margin:0 0 14px;{FONT}font-size:{size}px;line-height:1.3;'
        f'color:{NAVY};">{escape(title)}</h{level}>',
    )


def rule() -> Block:
    return Block(
        "—",
        f'<hr style="border:0;border-top:1px solid {BORDER};margin:24px 0;">',
    )


def page(subject: str, content: Block) -> tuple[str, str]:
    """E-mail complet, texte et HTML : en-tête du club, contenu, pied de page."""
    profile = app_url("/app/profil")
    footer = "Vous recevez cet e-mail selon vos préférences de notification."
    text = f"{content.text}\n\n--\nLSOC · {footer}\nGérer mes e-mails : {profile}\n"
    html = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:{PAGE};">
<div style="display:none;max-height:0;overflow:hidden;">{escape(subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid {BORDER};border-radius:10px;">
<tr><td style="padding:16px 24px;background:{NAVY};border-radius:10px 10px 0 0;{FONT}font-size:18px;font-weight:bold;letter-spacing:1px;color:#ffffff;">LSOC</td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:{RED};">&nbsp;</td></tr>
<tr><td style="padding:24px;">{content.html}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid {BORDER};{FONT}font-size:12px;line-height:1.5;color:{MUTED};">{escape(footer)}<br><a href="{escape(profile)}" style="color:{MUTED};">Gérer mes e-mails</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""
    return text, html
