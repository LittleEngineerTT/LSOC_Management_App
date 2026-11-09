from conftest import add_user, login
from fastapi.testclient import TestClient
from test_events import payload as base_payload, setup_planning


def payload(*args, **kwargs):  # type: ignore[no-untyped-def]
    kwargs.setdefault('start', '2099-10-15T18:00:00+02:00')
    kwargs.setdefault('end', '2099-10-15T20:00:00+02:00')
    return base_payload(*args, **kwargs)


def test_referent_and_admin_cancel_with_a_reason_and_reopen(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    add_user('coach1', ['member', 'coach'])
    add_user('other', ['member', 'coach'])
    event = admin.post('/api/v1/events', json=payload(section, gym, referent='coach1')).json()
    # Ni un autre coach ni un simple membre ne peuvent annuler.
    assert login('other').post(f"/api/v1/events/{event['id']}/cancellation", json={'base_version': event['version']}).status_code == 403
    # Le référent annule sans modification directe : le motif est son rôle.
    cancelled = login('coach1').post(f"/api/v1/events/{event['id']}/cancellation", json={'base_version': event['version']})
    assert cancelled.status_code == 200, cancelled.text
    assert (cancelled.json()['cancelled'], cancelled.json()['cancel_reason']) == (True, 'referent')
    assert admin.post(f"/api/v1/events/{event['id']}/cancellation", json={'base_version': cancelled.json()['version']}).status_code == 409
    reopened = login('coach1').delete(f"/api/v1/events/{event['id']}/cancellation", params={'base_version': cancelled.json()['version']})
    assert (reopened.json()['cancelled'], reopened.json()['cancel_reason']) == (False, '')
    # L’administrateur peut retenir la capacité du gymnase comme motif.
    capacity = admin.post(f"/api/v1/events/{event['id']}/cancellation", json={'base_version': reopened.json()['version'], 'reason': 'capacity'})
    assert capacity.json()['cancel_reason'] == 'capacity'
    plain = admin.delete(f"/api/v1/events/{event['id']}/cancellation", params={'base_version': capacity.json()['version']})
    assert admin.post(f"/api/v1/events/{event['id']}/cancellation", json={'base_version': plain.json()['version']}).json()['cancel_reason'] == 'admin'
    assert admin.post(f"/api/v1/events/{event['id']}/cancellation", json={'base_version': 1}).status_code == 409


def test_an_unavailability_conflict_names_the_block_and_lifts_itself(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=3)
    event = admin.post('/api/v1/events', json=payload(section, gym, courts=2)).json()
    block = {'title': 'Travaux', 'gymnasium_id': gym, 'courts': 3, 'starts_at': '2099-10-15T17:00:00+02:00', 'ends_at': '2099-10-15T22:00:00+02:00'}
    created = admin.post('/api/v1/availability-blocks', json=block)
    assert created.status_code == 201
    current = admin.get(f"/api/v1/events/{event['id']}").json()
    # Un conflit n’est pas une annulation : aucun motif d’annulation.
    assert (current['cancelled'], current['cancel_reason'], current['conflict'], current['conflict_note']) == (False, '', True, 'Travaux')
    # L’indisponibilité supprimée, le conflit se lève sans intervention.
    assert admin.delete(f"/api/v1/availability-blocks/{created.json()['id']}").status_code == 204
    restored = admin.get(f"/api/v1/events/{event['id']}").json()
    assert (restored['cancelled'], restored['conflict'], restored['conflict_note']) == (False, False, '')
