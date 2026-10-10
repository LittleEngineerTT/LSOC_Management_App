"""Discover source metadata without executing the FFVB page's scripts."""

import re
from urllib.parse import parse_qs, urlsplit

from bs4 import BeautifulSoup

from app.integrations.ffvb import parse_calendar


def url_parameters(value: str) -> tuple[str, str, str, str | None]:
    try:
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or url.hostname != "www.ffvbbeach.org"
            or url.username is not None
            or url.password is not None
            or url.port not in {None, 443}
            or url.path != "/ffvbapp/resu/vbspo_calendrier.php"
            or url.fragment
        ):
            raise ValueError("Utilisez l’URL HTTPS du calendrier officiel FFVB")
        query = parse_qs(url.query, keep_blank_values=True)
        for name in ("saison", "codent", "poule"):
            if len(query.get(name, [])) != 1:
                raise ValueError("L’URL doit contenir une saison, une entité et une poule uniques")
        season, entity, pool = query["saison"][0], query["codent"][0], query["poule"][0]
        if not re.fullmatch(r"\d{4}/\d{4}", season) or int(season[5:]) != int(season[:4]) + 1:
            raise ValueError("La saison de l’URL doit couvrir deux années consécutives")
        if any(not re.fullmatch(r"[A-Za-z0-9]{1,30}", part) for part in (entity, pool)):
            raise ValueError("Entité ou poule FFVB invalide")
        selected = query.get("equipe", [])
        if selected and (len(selected) != 1 or not re.fullmatch(r"\d{1,20}", selected[0])):
            raise ValueError("Numéro d’équipe ambigu ou invalide dans l’URL")
        return season, entity, pool, selected[0] if selected else None
    except (ValueError, IndexError) as error:
        raise ValueError(str(error)) from error


def club_candidates(
    html: bytes, season: str, entity: str, pool: str, club_code: str, selected: str | None
) -> list[tuple[str, str]]:
    # This validates the hidden source identity and presence of a real calendar.
    parse_calendar(html, season, entity, pool, "")
    soup = BeautifulSoup(html, "html.parser")
    candidates: set[tuple[str, str]] = set()
    for row in soup.find_all("tr"):
        name, number = "", ""
        for tag in row.find_all(["td", "input"]):
            if tag.name == "td" and "liengris_pt" in tag.get("class", []):
                label = tag.get_text(" ", strip=True)
                if label and not label.isdigit():
                    name = label
            elif tag.name == "input" and tag.get("name") == "equipe":
                number = str(tag.get("value", ""))
            elif tag.name == "input" and tag.get("name") == "cnclub":
                if (
                    str(tag.get("value", "")) == club_code
                    and name
                    and re.fullmatch(r"\d{1,20}", number)
                ):
                    if selected is None or selected == number:
                        candidates.add((number, name))
    return sorted(candidates)
