import re
from pathlib import Path
from zoneinfo import ZoneInfo

from conftest import add_user, login
from fastapi.testclient import TestClient
from sqlalchemy import update
from test_ffvb import HTML, configure, sync

from app.integrations.ffvb import Standing, calendar_codes, parse_calendar, parse_standings
from app.integrations.ffvb_source import club_candidates
from app.persistence.database import SessionFactory
from app.persistence.models import FFVBMatchState, FFVBSource

FIXTURES = Path(__file__).with_name('fixtures')
# Page du 21 octobre 2026 : une journée jouée, deux équipes encore sans match.
PLAYED = FIXTURES.joinpath('ffvb-brc-resultats.html').read_bytes()


def test_parser_reads_points_matches_and_score_breakdown() -> None:
    title, rows = parse_standings(PLAYED, 'BRC')
    assert title == 'BRC - LOISIR MIXTE BRONZE POULE C'
    assert [row.team for row in rows][:3] == ['PLESSIS-ROBINSON VOLLEY-BALL 3', 'RUEIL ATHLETIC CLUB 2', 'MEUDON CHAVILLE SEVRES VOLLEY 2']
    assert rows[5] == Standing(6, 'LSO COLOMBES', 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0)
    # Cases vides de la FFVB : une équipe qui n’a pas encore joué.
    assert rows[9] == Standing(10, 'AS SP BOURG LA REINE 4', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    assert len(rows) == 10


def test_parser_reads_regional_pools() -> None:
    _, men = parse_standings(FIXTURES.joinpath('ffvb-liidf-2mc.html').read_bytes(), '2MC')
    assert men[4] == Standing(5, 'LSO COLOMBES 1', 3, 2, 1, 1, 0, 0, 0, 1, 1, 0, 0)
    title, women = parse_standings(FIXTURES.joinpath('ffvb-liidf-2fc.html').read_bytes(), '2FC')
    assert title == '2FC - CHAMPIONNAT REGIONAL 2 SENIOR FEMININ : POULE C'
    assert women[0] == Standing(1, 'UGS DRAVEIL JUVISY ATHIS MONTGERON VB - DJAM VB', 9, 3, 3, 0, 0, 2, 1, 0, 0, 0, 0)
    assert women[4] == Standing(5, 'LSO COLOMBES', 5, 3, 2, 1, 0, 0, 1, 1, 0, 1, 0)
    assert women[9] == Standing(10, 'AS ELAN CHEVILLY-LARUE', 0, 3, 0, 3, 0, 0, 0, 0, 0, 3, 0)


def test_page_without_standings_reads_nothing() -> None:
    assert parse_standings(HTML, 'BRC')[1] == []


def test_standings_of_each_team_for_members_and_guests(admin: TestClient) -> None:
    source, section, _ = configure(admin)
    # Pas encore synchronisée : l’équipe est listée, sans classement.
    [item] = admin.get('/api/v1/ffvb/standings').json()
    assert (item['team_name'], item['rows'], item['updated_at'], item['title'], item['matches']) == ('LSO COLOMBES', [], None, None, [])
    sync(source, PLAYED)
    add_user()
    [item] = login().get('/api/v1/ffvb/standings').json()
    assert (item['source_id'], item['section_id'], item['section_name'], item['club_team'], item['pool'], item['season']) == (source, section, 'Loisir', 'LSO COLOMBES', 'BRC', '2026/2027')
    assert item['title'] == 'BRC - LOISIR MIXTE BRONZE POULE C'
    assert item['updated_at'] is not None
    assert item['rows'][5] == {'rank': 6, 'team': 'LSO COLOMBES', 'points': 0, 'played': 1, 'won': 0, 'lost': 1, 'forfeits': 0, 'wins_3_0': 0, 'wins_3_1': 0, 'wins_3_2': 0, 'losses_2_3': 0, 'losses_1_3': 1, 'losses_0_3': 0}
    # Tous les matchs de l’équipe, du plus ancien au plus récent.
    matches = item['matches']
    assert [match['match_code'] for match in matches][:3] == ['BRC005', 'BRC007', 'BRC014']
    assert len(matches) == 18
    # Joué avant le premier import : le score, sans lieu, la FFVB ne l’affichant plus.
    assert matches[0] == {'match_code': 'BRC005', 'kickoff_at': '2026-10-15T18:50:00Z', 'home_team': 'MEUDON CHAVILLE SEVRES VOLLEY 2', 'away_team': 'LSO COLOMBES', 'location': None, 'score': {'home_sets': 3, 'away_sets': 1, 'set_scores': ['23:21', '21:8', '18:21', '21:9'], 'points': '83-59'}}
    assert (matches[1]['location'], matches[1]['score'], matches[1]['kickoff_at']) == ('GYMNASE AMBROISE PARE', None, '2026-11-02T19:30:00Z')
    assert TestClient(admin.app).get('/api/v1/ffvb/standings').status_code == 401
    guest = TestClient(admin.app).get('/api/v1/public/ffvb/standings')
    assert guest.status_code == 200
    assert guest.json() == [item]


def test_page_without_standings_keeps_the_previous_one(admin: TestClient) -> None:
    source, _, _ = configure(admin)
    sync(source, PLAYED)
    sync(source, HTML)
    with SessionFactory() as db:
        value = db.get(FFVBSource, source)
        assert value is not None and value.standings is not None
        assert len(value.standings) == 10


def played_brc007(html: bytes) -> bytes:
    """Même page, BRC007 joué : la FFVB remplace alors son lieu par le score."""
    page = html.decode('latin-1')
    start = page.index('>BRC007<')
    end = page.index('</tr>', start)
    row = re.sub(
        r"<form name=divers method=post action=../adressier/fiche_match_ffvb.php.*</form><td></td><td class='liengris_pt'></td><td></td>",
        "<td>3</td><td>0</td><td>25:10, 25:12, 25:14</td><td>075-036</td><td></td><td></td>",
        page[start:end],
    )
    return (page[:start] + row + page[end:]).encode('latin-1')


def test_calendar_follows_the_ffvb_page_and_keeps_the_venue_of_played_matches(admin: TestClient) -> None:
    source, _, _ = configure(admin)
    sync(source, PLAYED)
    sync(source, played_brc007(PLAYED))
    [item] = admin.get('/api/v1/ffvb/standings').json()
    brc007 = next(match for match in item['matches'] if match['match_code'] == 'BRC007')
    assert brc007['location'] == 'GYMNASE AMBROISE PARE'
    assert brc007['score'] == {'home_sets': 3, 'away_sets': 0, 'set_scores': ['25:10', '25:12', '25:14'], 'points': '75-36'}
    # Le calendrier ne dépend pas de l’import : un match désactivé dans le planning y reste.
    with SessionFactory.begin() as db:
        db.execute(update(FFVBMatchState).values(disabled=True))
    sync(source, PLAYED)
    [item] = admin.get('/api/v1/ffvb/standings').json()
    assert len(item['matches']) == 18
    assert [match['score'] is None for match in item['matches']].count(True) == 17


def test_odd_pool_skips_the_bye_and_reads_every_match() -> None:
    # Treize équipes : LSO COLOMBES 2 est exempte de 1MA063 (adversaire « xxxxx », sans date).
    html = FIXTURES.joinpath('ffvb-ptidf92-1ma.html').read_bytes()
    matches = parse_calendar(html, '2026/2027', 'PTIDF92', '1MA', 'LSO COLOMBES 2')
    assert len(matches) == 12
    assert '1MA063' not in {match.code for match in matches}
    upcoming = [match for match in matches if match.result is None]
    assert (upcoming[0].code, upcoming[0].location) == ('1MA023', 'GYMNASE AMBROISE PARE')
    _, rows = parse_standings(html, '1MA')
    assert rows[1] == Standing(2, 'LSO COLOMBES 2', 7, 3, 2, 1, 0, 2, 0, 0, 1, 0, 0)
    assert len(rows) == 13
    # Garches n’a perdu aucun set : « MAX » en coefficient, pas en nom d’équipe.
    assert club_candidates(html, '2026/2027', 'PTIDF92', '1MA', '0928528', None) == [('12', 'GARCHES VAUCRESSON VOLLEY-BALL')]
    assert club_candidates(html, '2026/2027', 'PTIDF92', '1MA', '0926620', '10') == [('10', 'LSO COLOMBES 2')]


def test_matches_without_a_time_take_their_plateau_time_or_their_day() -> None:
    # Poule BFA : 16 matchs de LSO COLOMBES, la FFVB ne donnant souvent que l’heure du premier
    # match d’un plateau (même jour, même gymnase), et parfois aucune heure.
    html = FIXTURES.joinpath('ffvb-ptidf92-bfa.html').read_bytes()
    matches = {match.code: match for match in parse_calendar(html, '2026/2027', 'PTIDF92', 'BFA', 'LSO COLOMBES')}
    assert len(matches) == 16
    paris = ZoneInfo('Europe/Paris')
    # BFA008 suit BFA007 (14:30) au gymnase Verhaeren : il prend l’heure du plateau.
    assert matches['BFA007'].kickoff_at.astimezone(paris).strftime('%d/%m %H:%M') == '21/11 14:30'
    assert matches['BFA008'].kickoff_at.astimezone(paris).strftime('%d/%m %H:%M') == '21/11 14:30'
    assert not matches['BFA008'].time_unknown
    # BFA014 : aucune heure ce jour-là aux Platanes, il est placé sur sa journée.
    assert matches['BFA014'].time_unknown
    assert matches['BFA014'].kickoff_at.astimezone(paris).strftime('%d/%m %H:%M') == '05/12 00:00'


def test_matches_without_a_time_no_longer_break_the_page() -> None:
    # Poule BMA : des matchs ont une date mais pas d’heure (BMA005…) ; la page se lit.
    html = FIXTURES.joinpath('ffvb-ptidf92-bma.html').read_bytes()
    matches = {match.code: match for match in parse_calendar(html, '2026/2027', 'PTIDF92', 'BMA', 'LSO COLOMBES')}
    codes = set(matches)
    assert 'BMA005' in codes
    # Le premier match du plateau du 21/11 au Verhaeren (BMA004, 14:30) ne concerne pas LSO
    # COLOMBES : le calendrier complet de la poule donne quand même son heure au plateau.
    paris = ZoneInfo('Europe/Paris')
    for code in ('BMA005', 'BMA006'):
        assert matches[code].kickoff_at.astimezone(paris).strftime('%d/%m %H:%M') == '21/11 14:30'
        assert not matches[code].time_unknown
    assert codes <= calendar_codes(html, 'BMA', 'LSO COLOMBES')
    # La recherche des équipes du club lit la page sans erreur.
    club_candidates(html, '2026/2027', 'PTIDF92', 'BMA', '0926620', None)


def test_bye_rows_are_ignored_before_reading_the_date() -> None:
    # Poule MFA : LSO COLOMBES 2 est exempte de MFA008 (adversaire « xxxxx », sans date ni heure).
    html = FIXTURES.joinpath('ffvb-ptidf92-mfa.html').read_bytes()
    matches = parse_calendar(html, '2026/2027', 'PTIDF92', 'MFA', 'LSO COLOMBES 2')
    assert matches and 'MFA008' not in {match.code for match in matches}
    assert 'MFA008' not in calendar_codes(html, 'MFA', 'LSO COLOMBES 2')
    # La recherche des équipes du club lit la page sans erreur.
    club_candidates(html, '2026/2027', 'PTIDF92', 'MFA', '0926620', None)
