from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.integrations.ffvb import normalize
from app.persistence.database import SessionFactory
from app.persistence.models import Event, FFVBMatchState, FFVBSource
from test_events import setup_planning

FIXTURES = Path(__file__).parent / 'fixtures'
REGIONAL = (FIXTURES / 'ffvb-liidf-2mc.html').read_bytes()
DEPARTMENTAL = (FIXTURES / 'ffvb-original.html').read_bytes()


def source(admin: TestClient, section: str, team_name: str, entity: str, pool: str) -> str:
    team = admin.post('/api/v1/teams', json={'name': team_name, 'section_id': section, 'referent_ids': ['admin']}).json()['id']
    response = admin.post('/api/v1/ffvb/sources', json={'team_id': team, 'season': '2026/2027', 'entity': entity, 'pool': pool, 'team_number': '1', 'team_name': team_name, 'club_code': '0926620'})
    assert response.status_code == 201, response.text
    return str(response.json()['id'])


def sync(source_id: str, html: bytes) -> None:
    from app.services.ffvb import sync_source

    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=html))) as client:
        with SessionFactory.begin() as db:
            value = db.get(FFVBSource, source_id)
            assert value is not None
            sync_source(db, value, client)


def gyms_by_code() -> dict[str, str | None]:
    with SessionFactory() as db:
        rows = db.execute(select(FFVBMatchState.match_code, Event.gymnasium_id).join(Event, Event.ffvb_match_id == FFVBMatchState.id))
        return {code: gym for code, gym in rows}


def test_names_compare_without_accents_case_or_extra_spaces() -> None:
    assert normalize('  Gymnase   Ambroise Paré ') == normalize('GYMNASE AMBROISE PARE') == 'GYMNASE AMBROISE PARE'


def test_mapping_applies_immediately_and_ignores_accents(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    regional = source(admin, section, 'LSO COLOMBES 1', 'LIIDF', '2MC')
    admin.put(f'/api/v1/gymnasiums/{gym}', json={'name': 'Salle municipale', 'capacity': 3})
    sync(regional, REGIONAL)
    assert gyms_by_code()['2MCA022'] is None
    # Orthographe sans accent ni majuscules : l’association couvre « GYMNASE AMBROISE PARÉ ».
    created = admin.post('/api/v1/ffvb/gym-mappings', json={'official_name': 'gymnase ambroise pare', 'gymnasium_id': gym})
    assert created.status_code == 201, created.text
    gyms = gyms_by_code()
    assert gyms['2MCA022'] == gym and gyms['2MCR083'] == gym
    assert gyms['2MCA011'] is None
    duplicate = admin.post('/api/v1/ffvb/gym-mappings', json={'official_name': 'GYMNASE AMBROISE PARÉ', 'gymnasium_id': gym})
    assert duplicate.status_code == 409
    assert admin.delete(f"/api/v1/ffvb/gym-mappings/{created.json()['id']}").status_code == 204
    assert gyms_by_code()['2MCA022'] is None


def test_club_home_matches_join_the_local_gym_of_the_same_name(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    admin.put(f'/api/v1/gymnasiums/{gym}', json={'name': 'Gymnase Ambroise Paré', 'capacity': 3})
    regional = source(admin, section, 'LSO COLOMBES 1', 'LIIDF', '2MC')
    sync(regional, REGIONAL)
    gyms = gyms_by_code()
    # Pas d’association : le nom du gymnase local suffit pour une rencontre reçue par le club.
    assert gyms['2MCA022'] == gym and gyms['2MCR083'] == gym
    assert gyms['2MCA020'] is None


def test_prefix_rule_covers_club_hosted_matches_of_another_followed_team(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=10)
    departmental = source(admin, section, 'AS SP BOURG LA REINE 2', 'PTIDF92', 'BRC')
    sync(departmental, DEPARTMENTAL)
    # BRC007 : LSO COLOMBES reçoit l’équipe suivie au gymnase Ambroise Paré.
    assert gyms_by_code()['BRC007'] is None
    renamed = admin.put(f'/api/v1/gymnasiums/{gym}', json={'name': 'Gymnase Ambroise Paré', 'capacity': 10})
    assert renamed.status_code == 200
    with SessionFactory() as db:
        event = db.scalar(select(Event).join(FFVBMatchState, FFVBMatchState.id == Event.ffvb_match_id).where(FFVBMatchState.match_code == 'BRC007'))
        assert event is not None
        assert event.gymnasium_id == gym and event.courts == event.match_courts and not event.occupancy_unknown
    # Un match à l’extérieur de l’équipe suivie, sans le club à domicile, reste sans gymnase local.
    assert all(gym_id is None for code, gym_id in gyms_by_code().items() if code != 'BRC007')
