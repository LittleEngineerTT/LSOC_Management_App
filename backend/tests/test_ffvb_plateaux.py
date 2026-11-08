from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from test_ffvb import configure, sync

from app.persistence.database import SessionFactory
from app.persistence.models import Event, FFVBMatchState, FFVBSource, Follow, Notification

BFA = Path(__file__).with_name('fixtures').joinpath('ffvb-ptidf92-bfa.html').read_bytes()
PARIS = ZoneInfo('Europe/Paris')


def bfa_source(admin: TestClient) -> str:
    source, _, _ = configure(admin)
    with SessionFactory.begin() as db:
        db.execute(update(FFVBSource).where(FFVBSource.id == source).values(pool='BFA'))
    return source


def state(code: str) -> FFVBMatchState:
    with SessionFactory() as db:
        value = db.scalar(select(FFVBMatchState).where(FFVBMatchState.match_code == code))
        assert value is not None
        return value


def plateau_event(code: str) -> Event:
    with SessionFactory() as db:
        value = db.scalar(select(Event).where(Event.ffvb_match_id == state(code).id))
        assert value is not None
        return value


def test_a_plateau_is_one_event_at_the_time_of_its_first_match(admin: TestClient) -> None:
    sync(bfa_source(admin), BFA)
    with SessionFactory() as db:
        events = list(db.scalars(select(Event).where(Event.ffvb_match_id.is_not(None))))
    # 16 matchs de LSO COLOMBES, deux par plateau (même jour, même lieu) : 8 événements.
    assert len(events) == 8
    event = plateau_event('BFA007')
    assert event.title == 'SAINT-CLOUD PARIS SF 2 vs LSO COLOMBES vs AVANT GARDE ST DENIS'
    assert event.kickoff_at is not None
    assert event.kickoff_at.astimezone(PARIS).strftime('%d/%m %H:%M') == '21/11 14:30'
    # Le match suivant du plateau garde son état FFVB, sans événement propre.
    follower = state('BFA008')
    assert follower.plateau_id == state('BFA007').id
    with SessionFactory() as db:
        assert db.scalar(select(Event).where(Event.ffvb_match_id == follower.id)) is None
    # Le gymnase se déduit du premier match : BFA007 se joue chez Saint-Cloud, aucune alerte
    # « gymnase à associer » pour le Verhaeren, même si LSO reçoit BFA008.
    with SessionFactory() as db:
        titles = [item.title for item in db.scalars(select(Notification).where(Notification.kind == 'ffvb_unmapped'))]
    assert not any('VERHAEREN' in title for title in titles)


def test_matches_imported_separately_are_merged_into_their_plateau(admin: TestClient) -> None:
    source = bfa_source(admin)
    sync(source, BFA)
    leader = plateau_event('BFA007')
    # État d’avant les plateaux : BFA008 avait son propre événement, mis en favori.
    with SessionFactory.begin() as db:
        follower = db.get_one(FFVBMatchState, state('BFA008').id)
        follower.plateau_id = None
        alone = Event(**{key: getattr(leader, key) for key in ('kind', 'section_ids', 'team_ids', 'starts_at', 'ends_at', 'courts', 'referent_ids', 'before_minutes', 'after_minutes', 'match_courts')}, title='LSO COLOMBES / AVANT GARDE ST DENIS', location='GYMNASE VERHAEREN', ffvb_match_id=follower.id)
        db.add(alone)
        db.flush()
        db.add(Follow(user_id='admin', event_id=alone.id))
        alone_id = alone.id
    sync(source, BFA)
    with SessionFactory() as db:
        assert db.get(Event, alone_id) is None
        assert db.scalar(select(Follow.event_id).where(Follow.user_id == 'admin')) == leader.id
        # La fusion est silencieuse : aucune notification de suppression.
        assert db.scalar(select(Notification).where(Notification.kind == 'event_deleted')) is None
    assert state('BFA008').plateau_id == state('BFA007').id
