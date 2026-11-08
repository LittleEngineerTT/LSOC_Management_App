from datetime import UTC, date, datetime, timedelta

from conftest import add_user, login
from fastapi.testclient import TestClient
from test_events import payload, setup_planning

from app.services.events import PARIS, season_end


def next_weekday(weekday: int) -> date:
    """Prochain jour de la semaine (0 = lundi), au moins dans une semaine : jamais aujourd’hui."""
    today = datetime.now(UTC).astimezone(PARIS).date() + timedelta(days=7)
    return today + timedelta(days=(weekday - today.weekday()) % 7)


def at(day: date, hour: int, minute: int = 0) -> str:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=PARIS).isoformat()


def test_slot_search_lists_the_days_where_the_event_fits_without_conflict(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    other = admin.post('/api/v1/gymnasiums', json={'name': 'Stade', 'capacity': 1}).json()['id']
    tuesday = next_weekday(1)
    # Mardi : 2 terrains pris de 19 h à 21 h ; il n’en reste qu’un.
    assert admin.post('/api/v1/events', json=payload(section, gym, start=at(tuesday, 19), end=at(tuesday, 21), courts=2)).status_code == 201
    add_user('member')
    exact = {'weekdays': [1], 'start': '19:00', 'duration_minutes': 120, 'gymnasium_ids': [gym], 'courts': 2}
    # Réservée aux administrateurs.
    assert login().post('/api/v1/slot-search', json=exact).status_code == 403
    member = admin
    found = member.post('/api/v1/slot-search', json=exact)
    assert found.status_code == 200, found.text
    days = [item['day'] for item in found.json()]
    # Le mardi pris n’est pas proposé ; les autres mardis jusqu’au 31 juillet le sont.
    assert tuesday.isoformat() not in days
    assert days and all(date.fromisoformat(day).weekday() == 1 for day in days)
    assert max(days) <= season_end(datetime.now(UTC).astimezone(PARIS).date()).isoformat()
    # Une plage de 17 h à 23 h laisse place, ce mardi, avant 19 h (17 h) et après 21 h (21 h).
    window = exact | {'start': '17:00', 'end': '23:00'}
    slot = next(item for item in member.post('/api/v1/slot-search', json=window).json() if item['day'] == tuesday.isoformat())
    paris = lambda value: datetime.fromisoformat(value).astimezone(PARIS).strftime('%H:%M')  # noqa: E731
    assert (paris(slot['first_start']), paris(slot['last_start'])) == ('17:00', '21:00')
    # Une indisponibilité de toute la journée suivante écarte ce jour.
    wednesday = tuesday + timedelta(days=1)
    block = {'title': 'Travaux', 'gymnasium_id': gym, 'starts_at': at(wednesday, 0), 'ends_at': at(wednesday, 23, 59), 'courts': 3}
    assert admin.post('/api/v1/availability-blocks', json=block).status_code == 201
    every = member.post('/api/v1/slot-search', json=exact | {'weekdays': []}).json()
    assert wednesday.isoformat() not in [item['day'] for item in every]
    # Sans gymnase choisi, tous sont cherchés ; le Stade n’a qu’un terrain : jamais 2.
    everywhere = member.post('/api/v1/slot-search', json=exact | {'gymnasium_ids': []}).json()
    assert {item['gymnasium_id'] for item in everywhere} == {gym}
    assert other not in {item['gymnasium_id'] for item in everywhere}


def test_slot_search_validates_its_window(admin: TestClient) -> None:
    body = {'start': '20:00', 'end': '21:00', 'duration_minutes': 120, 'courts': 1}
    assert admin.post('/api/v1/slot-search', json=body).status_code == 422
    assert admin.post('/api/v1/slot-search', json=body | {'end': None, 'weekdays': [7]}).status_code == 422


def test_slot_search_stays_within_the_chosen_dates(admin: TestClient) -> None:
    _, gym = setup_planning(admin, capacity=3)
    tuesday = next_weekday(1)
    body = {'weekdays': [1], 'start': '19:00', 'duration_minutes': 60, 'gymnasium_ids': [gym], 'courts': 1}
    # Deux semaines choisies : exactement deux mardis.
    chosen = admin.post('/api/v1/slot-search', json=body | {'from_date': tuesday.isoformat(), 'to_date': (tuesday + timedelta(days=13)).isoformat()})
    assert chosen.status_code == 200, chosen.text
    assert [item['day'] for item in chosen.json()] == [tuesday.isoformat(), (tuesday + timedelta(days=7)).isoformat()]
    # Une période passée ne renvoie rien ; une fin avant le début est refusée.
    past = date(2020, 1, 1)
    assert admin.post('/api/v1/slot-search', json=body | {'from_date': past.isoformat(), 'to_date': '2020-02-01'}).json() == []
    assert admin.post('/api/v1/slot-search', json=body | {'from_date': tuesday.isoformat(), 'to_date': past.isoformat()}).status_code == 422
