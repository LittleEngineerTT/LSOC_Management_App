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
    # Aucune heure connue, même pour le plateau du jour : `kickoff_at` est minuit (Paris) de la
    # journée du match, dont l’heure reste à compléter.
    time_unknown: bool = False


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


def exempt(home: str, away: str) -> bool:
    """Poule à nombre impair d’équipes : l’équipe exempte d’une journée affronte « xxxxx »,
    sans date ni horaire. Ce n’est pas un match."""
    return any(re.fullmatch(r"x+", team, re.IGNORECASE) for team in (home, away))


def unscheduled(values: list[str]) -> bool:
    """Match annoncé sans date : la FFVB ne l’a pas encore programmé."""
    return not values[1]


def match_day(value: str) -> datetime:
    """Date FFVB (« 21/11/26 » ou « 21/11/2026 »), à minuit à Paris."""
    date_format = "%d/%m/%Y" if len(value.split("/")[-1]) == 4 else "%d/%m/%y"
    return datetime.strptime(value, date_format).replace(tzinfo=ZoneInfo("Europe/Paris"))


def plateau_times(soup: BeautifulSoup, pool: str) -> dict[tuple[str, str], str]:
    """Heure de chaque plateau (même jour, même lieu) : la FFVB n’indique souvent que celle du
    premier match ; les suivants s’enchaînent sur le même créneau. La plus tôt l’emporte."""
    times: dict[tuple[str, str], str] = {}
    for row in soup.find_all("tr"):
        first = row.find("td", recursive=False)
        if first is None:
            continue
        code = first.get_text(" ", strip=True)
        if re.fullmatch(re.escape(pool) + r"[A-Z]*\d+", code) is None:
            continue
        values = [cell.get_text(" ", strip=True) for cell in row.find_all("td")]
        if len(values) < 8 or not values[1] or not re.fullmatch(r"\d{1,2}:\d{2}", values[2]):
            continue
        key = (values[1], normalize(values[7]))
        if key not in times or values[2].zfill(5) < times[key].zfill(5):
            times[key] = values[2]
    return times


def calendar_codes(html: bytes, pool: str, team_name: str) -> set[str]:
    """Codes des matchs de l’équipe listés au calendrier, programmés ou non : un match encore
    sans horaire n’est pas importé, mais il n’a pas disparu du calendrier."""
    codes: set[str] = set()
    for row in BeautifulSoup(html, "html.parser").find_all("tr"):
        first = row.find("td", recursive=False)
        if first is None:
            continue
        code = first.get_text(" ", strip=True)
        if re.fullmatch(re.escape(pool) + r"[A-Z]*\d+", code) is None:
            continue
        values = [cell.get_text(" ", strip=True) for cell in row.find_all("td")]
        if len(values) < 6 or exempt(values[3], values[5]):
            continue
        if normalize(team_name) in {normalize(values[3]), normalize(values[5])}:
            codes.add(code)
    return codes


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
    plateaus = plateau_times(soup, pool)
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
        # L’exemption d’abord : une ligne « xxxxx » n’est jamais un match, quelle que soit sa forme.
        if len(values) >= 6 and exempt(values[3], values[5]):
            continue
        if len(values) < 8:
            raise ValueError("Ligne FFVB incomplète")
        home, away = values[3], values[5]
        if normalize(team_name) not in {normalize(home), normalize(away)}:
            continue
        # Date pas encore fixée : le match sera importé quand la FFVB la publiera.
        if unscheduled(values):
            continue
        # Sans heure, le match prend celle de son plateau ; sans plateau horodaté, il est importé
        # sur sa journée, l’heure restant à compléter.
        hour = values[2] or plateaus.get((values[1], normalize(values[7])), "")
        time_unknown = not hour
        try:
            day = match_day(values[1])
            kickoff = day
            if hour:
                parsed = datetime.strptime(hour, "%H:%M")
                kickoff = day.replace(hour=parsed.hour, minute=parsed.minute)
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
        matches.append(
            Match(code, kickoff.astimezone(UTC), home, away, location, result, time_unknown)
        )
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
