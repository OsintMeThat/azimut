"""Merge subjects through the public API, then follow and undo every reference."""
from __future__ import annotations

import io
import json
from contextlib import closing
import sqlite3

import pytest
from PIL import Image

from azimut.workspace import Case
from azimut.engine import bundles, merge, sheets, satellite
from azimut.store.merges import rewrite_view_spec


@pytest.fixture
def case(client):
    cid = client.post('/api/cases', json={'name': 'Merge checks'}).json()['id']
    return Case.open(cid)


def subject(case, label, type_='person', **attrs):
    return case.add_entity(type_, label, attrs, by='user')


def rated_link(case, a, b, confidence, nature):
    link = case.add_link(a['id'], b['id'], 'associated-with', by='user')
    case.update_link(link['id'], {'confidence': confidence, 'nature': nature})


def post(client, case, keep, other):
    response = client.post(f'/api/cases/{case.id}/entities/{keep["id"]}/merge', json={'other': other['id']})
    assert response.status_code == 200, response.text
    return response.json()


def undo(client, case, result):
    response = client.post(f'/api/cases/{case.id}/merges/{result["merge"]}/undo')
    assert response.status_code == 200, response.text
    return response.json()


def test_preview_is_read_only_even_in_batch_and_matches_commit(client, case):
    a = subject(case, 'Subject A', aliases='First', notes='Original')
    b = subject(case, 'Subject B', aliases='Second', notes='Other note')
    claim = subject(case, 'Observed', 'claim', when='2026-03-12')
    edge = case.add_link(claim['id'], b['id'], 'about', by='user')
    before = case.list_entities(), case.list_links(), case.temporal_projection_status()
    with case.batch():
        preview = merge.preview(case, a['id'], b['id'])
    assert (case.list_entities(), case.list_links(), case.temporal_projection_status()) == before
    assert case.merges_into(a['id']) == []
    result = post(client, case, a, b)
    assert result['links'] == preview['links']
    assert result['survivor']['attrs']['aliases'] == 'First; Subject B; Second'
    assert 'Other note' in result['survivor']['attrs']['notes']
    assert case.links_of(claim['id'])[0]['id'] == edge['id']
    assert case.links_of(claim['id'])[0]['to'] == a['id']
    assert case.temporal_projection_status()['consistent']
    read = client.get(f'/api/cases/{case.id}/entities/{b["id"]}/chain').json()
    assert read['entity']['id'] == a['id']
    assert read['merged_from']['id'] == b['id']
    restored = undo(client, case, result)
    assert restored['lost'] == []
    assert case.get_entity(a['id']) == a
    assert case.get_entity(b['id']) == b
    assert case.list_links() == before[1]
    assert case.entity_redirects() == {}
    assert case.merges_into(a['id']) == []


@pytest.mark.parametrize('type_', ['claim', 'media', 'note', 'proof', 'bookmark'])
def test_non_subjects_refused(client, case, type_):
    a, b = subject(case, 'A', type_), subject(case, 'B', type_)
    response = client.post(f'/api/cases/{case.id}/entities/{a["id"]}/merge', json={'other': b['id']})
    assert response.status_code == 409
    assert case.get_entity(b['id']) == b


def test_self_and_different_types_refused(client, case):
    a, b = subject(case, 'A'), subject(case, 'B', 'organization')
    for other in (a, b):
        assert client.post(f'/api/cases/{case.id}/entities/{a["id"]}/merge', json={'other': other['id']}).status_code == 409


def test_duplicate_and_loop_edges_restore_without_losing_assessments(client, case):
    a, b, c = [subject(case, label, 'organization') for label in ('A', 'B', 'C')]
    rated_link(case, a, c, 1, 'partner')
    rated_link(case, b, c, 1, 'partner')
    rated_link(case, b, c, 2, 'supplier')
    case.add_link(a['id'], b['id'], 'associated-with', by='user')
    before = case.list_links()
    result = post(client, case, a, b)
    assert result['links'] == {'moved': 1, 'twins': 1, 'loops': 1, 'refused': 0}
    assert {edge.get('nature') for edge in case.list_links()} == {'partner', 'supplier'}
    undo(client, case, result)
    assert sorted(case.list_links(), key=lambda e: e['id']) == sorted(before, key=lambda e: e['id'])


def test_cycle_refuses_entire_merge_in_preview_and_commit(client, case):
    a, b, c = [subject(case, label, 'organization') for label in ('A', 'B', 'C')]
    case.add_link(a['id'], c['id'], 'part-of', by='user')
    case.add_link(c['id'], b['id'], 'part-of', by='user')
    before = case.list_links()
    assert merge.preview(case, a['id'], b['id'])['refused']
    response = client.post(f'/api/cases/{case.id}/entities/{a["id"]}/merge', json={'other': b['id']})
    assert response.status_code == 409
    assert case.list_links() == before
    assert case.get_entity(b['id']) == b


def test_compressed_redirects_and_successive_undo(client, case):
    a, b, c = [subject(case, label) for label in ('A', 'B', 'C')]
    first = post(client, case, b, a)
    second = post(client, case, c, b)
    assert case.entity_redirects([a['id']])[a['id']]['id'] == c['id']
    assert client.post(f'/api/cases/{case.id}/merges/{first["merge"]}/undo').status_code == 409
    undo(client, case, second)
    assert case.entity_redirects([a['id']])[a['id']]['id'] == b['id']
    undo(client, case, first)
    assert case.entity_redirects() == {}


def test_partial_undo_preserves_later_notes_and_reports_deleted_edge(client, case):
    a, b, c = [subject(case, label) for label in ('A', 'B', 'C')]
    edge = case.add_link(b['id'], c['id'], 'associated-with', by='user')
    result = post(client, case, a, b)
    case.update_entity(a['id'], {'attrs': {'aliases': 'Written later'}})
    case.remove_link(edge['id'])
    answer = undo(client, case, result)
    assert len(answer['lost']) == 2
    assert case.get_entity(a['id'])['attrs']['aliases'] == 'Written later'


def test_photos_and_graph_positions_round_trip(client, case):
    a, b = subject(case, 'A'), subject(case, 'B')
    media = subject(case, 'Frame', 'media', kind='image', path='media/frame.png')
    for owner in (a, b):
        answer = client.post(f'/api/cases/{case.id}/entities/{owner["id"]}/images', json={'media_ids': [media['id']]})
        assert answer.status_code == 200, answer.text
    picture = io.BytesIO()
    Image.new('RGB', (8, 8), 'red').save(picture, format='PNG')
    response = client.post(f'/api/cases/{case.id}/entities/{b["id"]}/images/upload', files={'file': ('photo.png', picture.getvalue(), 'image/png')})
    assert response.status_code == 200, response.text
    before = {e['id']: case.entity_images(e['id']) for e in (a, b)}
    case.pin_entities('all', {a['id']: (1, 2), b['id']: (3, 4)})
    case.pin_entities('ownership', {b['id']: (5, 6)})
    result = post(client, case, a, b)
    assert len(case.entity_images(a['id'])) == 2
    assert sum(row['primary'] for row in case.entity_images(a['id'])) == 1
    assert case.graph_pins('all') == {a['id']: (1, 2)}
    assert case.graph_pins('ownership') == {a['id']: (5, 6)}
    undo(client, case, result)
    assert {e['id']: case.entity_images(e['id']) for e in (a, b)} == before
    assert case.graph_pins('all') == {a['id']: (1, 2), b['id']: (3, 4)}


def test_sheet_references_recover_and_undo_without_changing_csv(client, case, monkeypatch):
    a, b = subject(case, 'A'), subject(case, 'B')
    sheet = client.post(f'/api/cases/{case.id}/sheets', json={'title': 'Worklist'}).json()
    saved = client.put(f'/api/cases/{case.id}/sheets/{sheet["id"]}', json={'columns': ['id', 'Subject'], 'rows': [['r1', 'B']], 'meta': {'links': {'r1': {'Subject': b['id']}}, 'values': {'Subject': {'B': b['id']}}, 'attachments': {'r1': [b['id'], a['id']]}}})
    assert saved.status_code == 200, saved.text
    csv, path = sheets._paths(case, sheet)
    before, csv_before = json.loads(path.read_text()), csv.read_bytes()
    original = sheets.write_atomic
    def fail(*args, **kwargs):
        raise OSError('locked file')
    monkeypatch.setattr(sheets, 'write_atomic', fail)
    result = merge.merge(case, a['id'], b['id'])
    assert result['warnings']
    assert case.pending_merge_work()
    monkeypatch.setattr(sheets, 'write_atomic', original)
    Case.open(case.id)
    assert not case.pending_merge_work()
    after = json.loads(path.read_text())
    assert after['links']['r1']['Subject'] == a['id']
    assert after['attachments']['r1'] == [a['id']]
    assert all(edge['to'] != b['id'] for edge in case.links_of(sheet['id']))
    undo(client, case, result)
    assert json.loads(path.read_text()) == before
    assert csv.read_bytes() == csv_before


def test_places_keep_both_coordinate_keys(client, case):
    a = subject(case, 'A', 'place', lat=1, lon=2)
    b = subject(case, 'B', 'place', lat=3, lon=4, enrich_coord_key=satellite.coord_key(3, 4))
    result = post(client, case, a, b)
    assert satellite.place_at(case, 3, 4)['id'] == a['id']
    assert satellite.place_at(case, 1, 2, keyed_only=False)['id'] == a['id']
    undo(client, case, result)
    assert satellite.place_at(case, 3, 4)['id'] == b['id']


def test_merge_preserves_names_kept_from_an_earlier_type(client, case):
    a = subject(case, 'A', 'vehicle', aliases='Earlier A', _retained_fields={'aliases': 'person'})
    b = subject(case, 'B', 'vehicle', aliases='Earlier B', _retained_fields={'aliases': 'person'})
    result = post(client, case, a, b)
    assert result['survivor']['attrs']['aliases'] == 'Earlier A'
    assert 'Earlier B' in result['survivor']['attrs']['notes']
    undo(client, case, result)
    assert case.get_entity(b['id']) == b


def test_merge_preserves_the_original_enrichment_key_after_a_place_was_corrected(client, case):
    a = subject(case, 'A', 'place', lat=1, lon=2)
    b = subject(case, 'B', 'place', lat=3, lon=4, enrich_coord_key=satellite.coord_key(5, 6))
    post(client, case, a, b)
    assert satellite.place_at(case, 5, 6)['id'] == a['id']


def test_trash_restore_resolves_old_subject_and_purge_clears_journal(client, case):
    a, b = subject(case, 'A'), subject(case, 'B')
    claim = subject(case, 'Observation', 'claim')
    case.add_link(claim['id'], b['id'], 'about', by='user')
    deleted = client.delete(f'/api/cases/{case.id}/entities/{claim["id"]}').json()
    result = post(client, case, a, b)
    from azimut.engine import trash
    trash.restore(case, deleted['trash'])
    assert case.links_of(claim['id'])[0]['to'] == a['id']
    deleted = client.delete(f'/api/cases/{case.id}/entities/{a["id"]}').json()
    assert client.post(f'/api/cases/{case.id}/merges/{result["merge"]}/undo').status_code == 409
    report = client.get(f'/api/cases/{case.id}/doctor').json()
    assert not any(i['kind'] == 'redirect-dangling' for i in report['issues'])
    trash.purge(case, deleted['trash'])
    assert case.entity_redirects() == {}
    assert case.merges_into(a['id']) == []


def test_bundle_keeps_redirects_and_finalizes_merge(client, case):
    a, b = subject(case, 'A'), subject(case, 'B')
    result = post(client, case, a, b)
    exported = bundles.export_case(case)
    destination = Case.create('Imported')
    bundles.import_into(destination, exported)
    imported = Case.open(destination.id)
    assert imported.entity_redirects()[b['id']]['id'] == a['id']
    assert imported.get_merge(result['merge']) is None
    assert case.get_merge(result['merge']) is not None


def test_doctor_repairs_only_dangling_redirect(client, case):
    a, b = subject(case, 'A'), subject(case, 'B')
    post(client, case, a, b)
    route = f'/api/cases/{case.id}/doctor/repair'
    assert client.post(route, json={'action': 'drop-redirect', 'entity_id': b['id']}).status_code == 409
    with closing(sqlite3.connect(case.db_path)) as conn, conn:
        conn.execute('DELETE FROM entities WHERE id = ?', (a['id'],))
    answer = client.post(route, json={'action': 'drop-redirect', 'entity_id': b['id']})
    assert answer.status_code == 200, answer.text
    assert case.entity_redirects() == {}


def test_composite_temporal_ids_are_repointed_without_substring_replacement():
    before = {'timeline': {'entity': {'id': 'old', 'label': 'Old'}, 'tracks': [{'pinned': ['temporal:activity:old:filed', 'temporal:activity:older:filed'], 'hidden': []}]}}
    after, changed = rewrite_view_spec(before, 'old', 'new')
    assert changed
    assert after['timeline']['tracks'][0]['pinned'] == ['temporal:activity:new:filed', 'temporal:activity:older:filed']
    assert before['timeline']['entity']['id'] == 'old'


def test_live_views_follow_merge_snapshots_stay_frozen_and_undo_keeps_later_edits(client, case):
    a, b = subject(case, 'A'), subject(case, 'B')
    specs = {
        'graph': {'graph': {'root': b['id'], 'kept': [a['id'], b['id']], 'expanded': [b['id']],
                            'putAway': {b['id']: [b['id']]}, 'arrangement': [{'id': b['id'], 'x': 1, 'y': 2}]}},
        'timeline': {'timeline': {'entity': {'id': b['id'], 'label': 'B'}, 'tracks': [
            {'pinned': [f'temporal:activity:{b["id"]}:filed'], 'hidden': []}]}},
        'frozen': {'snapshot': {'entities': [b]}, 'graph': {'root': b['id']}},
    }
    before = {}
    for name, spec in specs.items():
        before[name] = case.save_analysis_view({'id': name, 'name': name, 'mode': 'snapshot' if name == 'frozen' else 'live',
            'surface': 'timeline' if name == 'timeline' else 'graph', 'spec': spec, 'created_at': '2026-09-01', 'updated_at': '2026-09-01'})
    result = post(client, case, a, b)
    graph = case.get_analysis_view('graph')
    assert graph['spec']['graph']['root'] == a['id']
    assert graph['spec']['graph']['kept'] == [a['id']]
    assert graph['spec']['graph']['putAway'] == {a['id']: [a['id']]}
    assert case.get_analysis_view('timeline')['spec']['timeline']['entity'] == {'id': a['id'], 'label': 'A'}
    assert case.get_analysis_view('frozen') == before['frozen']
    graph['spec']['graph']['expanded'] = []
    case.save_analysis_view(graph)
    answer = undo(client, case, result)
    assert any('graph' in loss for loss in answer['lost'])
    assert case.get_analysis_view('graph') == graph
    assert case.get_analysis_view('timeline') == before['timeline']
    assert case.get_analysis_view('frozen') == before['frozen']


def test_interrupted_undo_replays_once_on_reopen_and_blocks_bundle(client, case, monkeypatch):
    a, b = subject(case, 'A'), subject(case, 'B')
    sheet = client.post(f'/api/cases/{case.id}/sheets', json={'title': 'Worklist'}).json()
    response = client.put(f'/api/cases/{case.id}/sheets/{sheet["id"]}', json={
        'columns': ['id', 'Subject'], 'rows': [['r1', 'B']], 'meta': {'links': {'r1': {'Subject': b['id']}}}})
    assert response.status_code == 200
    _, path = sheets._paths(case, sheet)
    before = json.loads(path.read_text())
    result = post(client, case, a, b)
    original = sheets.write_atomic
    def fail(*args, **kwargs):
        raise OSError('locked file')
    monkeypatch.setattr(sheets, 'write_atomic', fail)
    assert merge.undo(case, result['merge'])['lost']
    assert case.get_entity(b['id']) == b
    assert case.pending_merge_work()
    with pytest.raises(bundles.BundleError, match='sheet'):
        bundles.export_case(case)
    monkeypatch.setattr(sheets, 'write_atomic', original)
    Case.open(case.id)
    assert json.loads(path.read_text()) == before
    assert not case.pending_merge_work()
    assert case.get_merge(result['merge']) is None
    Case.open(case.id)
    assert json.loads(path.read_text()) == before


def test_opening_a_case_parses_only_merges_with_work_left(client, case, monkeypatch):
    """Merge records stay for Undo and every request opens the case, so finished
    merges must cost the open nothing, however many there are."""
    keep = subject(case, 'Keep')
    for n in range(4):
        post(client, case, keep, subject(case, f'Twin {n}'))
    parsed = []
    real = json.loads

    def counting(text, *args, **kwargs):
        parsed.append(text)
        return real(text, *args, **kwargs)

    monkeypatch.setattr(json, 'loads', counting)
    assert case.pending_merge_work() == []
    assert parsed == []
