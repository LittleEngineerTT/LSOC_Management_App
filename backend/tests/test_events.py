from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from conftest import add_user, login


def setup_planning(admin: TestClient, capacity: int = 3) -> tuple[str, str]:
    section = admin.post('/api/v1/sections', json={'name': 'Loisir'}).json()['id']
    gym = admin.post('/api/v1/gymnasiums', json={'name': 'Ambroise Paré', 'capacity': capacity}).json()['id']
    return section, gym


def payload(section: str, gym: str | None, start: str = '2026-10-15T18:00:00+02:00', end: str = '2026-10-15T20:00:00+02:00', courts: int = 2, referent: str = 'admin') -> dict[str, object]:
    return {'title': 'Entraînement', 'kind': 'training', 'section_ids': [section], 'gymnasium_id': gym, 'starts_at': start, 'ends_at': end, 'courts': courts, 'referent_ids': [referent]}


def test_partial_overlap_adjacent_and_capacity_force(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    first = admin.post('/api/v1/events', json=payload(section, gym))
    assert first.status_code == 201, first.text
    assert admin.post('/api/v1/events', json=payload(section, gym, start='2026-10-15T20:00:00+02:00', end='2026-10-15T22:00:00+02:00', courts=3)).status_code == 201
    overlap = payload(section, gym, start='2026-10-15T19:00:00+02:00', end='2026-10-15T21:00:00+02:00')
    assert admin.post('/api/v1/events', json=overlap).status_code == 409
    r = admin.post('/api/v1/events?force=true', json=overlap)
    assert r.status_code == 201
    capacity = admin.get(f'/api/v1/gymnasiums/{gym}/availability', params={'starts_at': '2026-10-15T18:00:00+02:00', 'ends_at': '2026-10-15T22:00:00+02:00'}).json()
    assert [(s['occupied'], s['available'], s['excess']) for s in capacity['segments']] == [(2,1,0),(4,0,1),(5,0,2),(3,0,0)]
    hist = admin.get(f"/api/v1/events/{r.json()['id']}/history").json()
    assert hist[0]['forced'] is True


def test_referent_permissions_requests_stale_and_cancel(admin: TestClient) -> None:
    add_user()
    add_user('coach', ['coach'])
    member, coach = login(), login('coach')
    section, gym = setup_planning(admin)
    r = admin.post('/api/v1/events', json=payload(section, gym, referent='member'))
    assert r.status_code == 201
    event_id = r.json()['id']
    change = {'base_version': 1, 'changes': {'title': 'Nouvelle séance'}}
    assert coach.patch(f'/api/v1/events/{event_id}', json=change).status_code == 403
    assert member.patch(f'/api/v1/events/{event_id}', json=change).status_code == 403
    request = member.post(f'/api/v1/events/{event_id}/change-requests', json=change)
    assert request.status_code == 201
    assert member.get(f'/api/v1/events/{event_id}').json()['title'] == 'Entraînement'
    assert admin.patch(f'/api/v1/events/{event_id}', json={'base_version':1, 'changes':{'direct_edit':True}}).status_code == 200
    assert admin.post(f"/api/v1/change-requests/{request.json()['id']}/decision", json={'accept':True}).status_code == 409
    assert member.patch(f'/api/v1/events/{event_id}', json={'base_version':2, 'changes':{'cancelled':True}}).status_code == 200
    assert admin.post('/api/v1/events', json=payload(section, gym, courts=3)).status_code == 201


def test_recurrence_preserves_wall_time_and_exception(admin: TestClient) -> None:
    section, gym = setup_planning(admin)
    r = admin.post('/api/v1/series', json={'event':payload(section,gym,start='2026-10-18T20:00:00+02:00',end='2026-10-18T22:00:00+02:00'), 'until':'2026-11-01'})
    assert r.status_code == 201, r.text
    events = r.json()
    assert len(events) == 3
    assert [e['starts_at'] for e in events] == ['2026-10-18T18:00:00Z','2026-10-25T19:00:00Z','2026-11-01T19:00:00Z']
    assert admin.patch(f"/api/v1/events/{events[1]['id']}", json={'base_version':1,'changes':{'title':'Exception'}}).status_code == 200
    r = admin.patch(f"/api/v1/series/{events[0]['series_id']}", json={'from_event_id':events[0]['id'], 'base_version':1,'changes':{'title':'Série ajustée'}})
    assert r.status_code == 200, r.text
    titles = admin.get('/api/v1/events').json()
    assert [e['title'] for e in titles] == ['Série ajustée','Exception','Série ajustée']


def test_concurrent_reservations_do_not_overbook(admin: TestClient) -> None:
    section, gym = setup_planning(admin, capacity=2)
    cookies, csrf = dict(admin.cookies), admin.headers['X-CSRF-Token']
    def reserve(_: int) -> int:
        with TestClient(admin.app, cookies=cookies, headers={'X-CSRF-Token':csrf}) as client:
            return client.post('/api/v1/events', json=payload(section,gym,courts=2)).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(reserve, range(2))) == [201,409]


def test_availability_block_and_restore(admin: TestClient) -> None:
    section,gym = setup_planning(admin)
    event = admin.post('/api/v1/events',json=payload(section,gym)).json()
    block = admin.post('/api/v1/availability-blocks',json={'gymnasium_id':gym,'title':'Travaux','courts':2,'starts_at':'2026-10-15T19:00:00+02:00','ends_at':'2026-10-15T21:00:00+02:00'})
    assert block.status_code == 201
    # L’indisponibilité l’emporte : l’événement est annulé et son référent prévenu.
    cancelled=admin.get(f"/api/v1/events/{event['id']}").json()
    assert cancelled['cancelled'] is True and cancelled['version']==2
    assert any(n['kind']=='event_cancelled' for n in admin.get('/api/v1/notifications').json())
    assert admin.delete(f"/api/v1/availability-blocks/{block.json()['id']}").status_code == 204
    updated=admin.patch(f"/api/v1/events/{event['id']}",json={'base_version':2,'changes':{'title':'Modifié'}})
    assert updated.status_code==200
    revision=admin.get(f"/api/v1/events/{event['id']}/history").json()[-1]
    assert admin.post(f"/api/v1/events/{event['id']}/history/{revision['id']}/restore",json={'base_version':3,'fields':['title']}).json()['title']=='Entraînement'
