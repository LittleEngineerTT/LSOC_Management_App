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
class Result:
    """Score d’un match joué : sets gagnés, détail des sets (« 25:21 ») et total des points."""

    home_sets: int
    away_sets: int
    sets: tuple[str, ...]
    points: str


@dataclass(frozen=True)
class Match:
    code: str
    kickoff_at: datetime
    home_team: str
    away_team: str
    # Absent d’un match déjà joué : la FFVB affiche alors le score à la place du lieu.
    location: str | None
    result: Result | None = None


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
        result = (
            Result(
                int(values[6]),
                int(values[7]),
                tuple(re.findall(r"\d+:\d+", values[8])),
                # « 083-059 » : total des points, sans les zéros de remplissage.
                re.sub(r"\b0+(\d)", r"\1", values[9]) if len(values) > 9 else "",
            )
            if played
            else None
        )
        matches.append(Match(code, kickoff.astimezone(UTC), home, away, location, result))
    if not found_calendar:
        raise ValueError("Calendrier FFVB introuvable")
    return matches


# Colonnes du classement FFVB retenues, par intitulé d’en-tête : points, matchs joués, gagnés,
# perdus, forfaits et répartition des scores.
STANDING_COLUMNS = {
    "Points": "points",
    "Jou.": "played",
    "Gag.": "won",
    "Per.": "lost",
    "F.": "forfeits",
    "3-0": "wins_3_0",
    "3-1": "wins_3_1",
    "3-2": "wins_3_2",
    "2-3": "losses_2_3",
    "1-3": "losses_1_3",
    "0-3": "losses_0_3",
}


@dataclass(frozen=True)
class Standing:
    """Ligne du classement d’une poule ; une case vide de la FFVB vaut 0."""

    rank: int
    team: str
    points: int
    played: int
    won: int
    lost: int
    forfeits: int
    wins_3_0: int
    wins_3_1: int
    wins_3_2: int
    losses_2_3: int
    losses_1_3: int
    losses_0_3: int


def parse_standings(html: bytes, pool: str) -> tuple[str | None, list[Standing]]:
    """Intitulé de la compétition et classement de la poule, tels que publiés par la FFVB.

    Sans tableau de classement, la liste est vide ; une ligne illisible lève `ValueError`.
    """
    soup = BeautifulSoup(html, "html.parser")
    title = next(
        (
            text
            for cell in soup.find_all("td", class_="titreblanc")
            if (text := cell.get_text(" ", strip=True)).startswith(f"{pool} ")
        ),
        None,
    )
    header: dict[str, int] | None = None
    standings: list[Standing] = []
    for row in soup.find_all("tr"):
        # Cases directes seulement : la ligne qui contient tout le tableau est ainsi ignorée.
        cells = [cell.get_text(" ", strip=True) for cell in row.find_all("td", recursive=False)]
        if header is None:
            if set(STANDING_COLUMNS) <= set(cells):
                header = {label: index for index, label in enumerate(cells)}
            continue
        if not cells or re.fullmatch(r"\d+\.", cells[0]) is None:
            if standings:
                break
            continue
        values: dict[str, int] = {}
        for label, key in STANDING_COLUMNS.items():
            index = header[label]
            value = cells[index] if index < len(cells) else ""
            if value and not value.isdigit():
                raise ValueError("Classement FFVB inexploitable")
            values[key] = int(value or 0)
        if len(cells) < 2 or not cells[1]:
            raise ValueError("Classement FFVB inexploitable")
        standings.append(Standing(rank=int(cells[0][:-1]), team=cells[1], **values))
    return title, standings
