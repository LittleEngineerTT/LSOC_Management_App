import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import httpx
from bs4 import BeautifulSoup

URL = "https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php"


def normalize(value: str) -> str:
    """Clé de comparaison des noms FFVB : sans accents, sans casse, espaces réduits."""
    decomposed = unicodedata.normalize("NFKD", value)
    bare = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(unicodedata.normalize("NFKC", bare).upper().split())


@dataclass(frozen=True)
class Match:
    code: str
    kickoff_at: datetime
    home_team: str
    away_team: str
    # Absent d’un match déjà joué : la FFVB affiche alors le score à la place du lieu.
    location: str | None


def fetch(client: httpx.Client, season: str, entity: str, pool: str) -> bytes:
    response = client.get(
        URL,
        params={"saison": season, "codent": entity, "poule": pool},
        timeout=30,
        follow_redirects=False,
    )
    response.raise_for_status()
    if len(response.content) > 4_000_000:
        raise ValueError("Page FFVB trop volumineuse")
    return response.content


def parse_calendar(html: bytes, season: str, entity: str, pool: str, team_name: str) -> list[Match]:
    soup = BeautifulSoup(html, "html.parser")
    for name, expected in [("saison", season), ("codent", entity), ("poule", pool)]:
        header_values = {
            str(tag.get("value", "")) for tag in soup.find_all("input", attrs={"name": name})
        }
        if expected not in header_values:
            raise ValueError("Page FFVB ne correspondant pas à la source configurée")
    matches: list[Match] = []
    found_calendar = False
    for row in soup.find_all("tr"):
        first = row.find("td", recursive=False)
        if first is None:
            continue
        code = first.get_text(" ", strip=True)
        # Codes « BRC007 » ou, selon les poules, avec une phase en lettres : « 2MCA001 ».
        if re.fullmatch(re.escape(pool) + r"[A-Z]*\d+", code) is None:
            continue
        found_calendar = True
        cells = row.find_all("td")
        values = [cell.get_text(" ", strip=True) for cell in cells]
        if len(values) < 8:
            raise ValueError("Ligne FFVB incomplète")
        home, away = values[3], values[5]
        if normalize(team_name) not in {normalize(home), normalize(away)}:
            continue
        try:
            date_format = "%d/%m/%Y" if len(values[1].split("/")[-1]) == 4 else "%d/%m/%y"
            kickoff = datetime.strptime(
                values[1] + " " + values[2], date_format + " %H:%M"
            ).replace(tzinfo=ZoneInfo("Europe/Paris"))
        except ValueError as exc:
            raise ValueError(f"Horaires FFVB inexploitables pour {code}") from exc
        if kickoff.year not in {int(year) for year in season.split("/")}:
            raise ValueError("Date FFVB hors saison")
        played = (
            len(values) >= 9
            and all(re.fullmatch(r"\d+", value) for value in values[6:8])
            and re.search(r"\d+:\d+", values[8]) is not None
        )
        location = None if played else values[7]
        matches.append(Match(code, kickoff.astimezone(UTC), home, away, location))
    if not found_calendar:
        raise ValueError("Calendrier FFVB introuvable")
    return matches
