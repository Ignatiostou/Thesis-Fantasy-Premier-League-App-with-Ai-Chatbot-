import sys
from pathlib import Path
import numpy as np
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'evaluation'))
from run_enriched import snapshot_rows, GROUPS, FEATURES

def fixture():
    team = {'id': 1, **{c[5:]: 1000 for c in GROUPS['team_strength']}}
    el = dict(id=1, code=123, web_name='Example', team=1, element_type=2,
              status='a', chance_of_playing_next_round=None, now_cost=55,
              selected_by_percent='12.5', form='3.4', total_points=999)
    p = {'elements': [el], 'teams': [team], 'events': [
        dict(id=1, finished=True, is_next=False, deadline_time='2025-08-10T10:00:00Z'),
        dict(id=2, finished=False, is_next=True, deadline_time='2025-08-17T10:00:00Z')]}
    m = dict(event=2, captured_at='2025-08-17T09:00:00Z', event_deadline='2025-08-17T10:00:00Z')
    return p, m

def test_null_units_encoding():
    p, m = fixture(); r = snapshot_rows(p, m)[0]
    assert np.isnan(r['snapshot_chance']) and r['snapshot_chance_missing'] == 1
    assert r['snapshot_price'] == 5.5 and r['snapshot_ownership'] == .125
    assert r['position_2'] == 1
    assert sum(r[c] for c in GROUPS['position']) == 1

def test_deadline_event_guards():
    p, m = fixture(); m['captured_at'] = m['event_deadline']
    with pytest.raises(ValueError): snapshot_rows(p, m)
    p, m = fixture(); p['events'][1]['is_next'] = False
    with pytest.raises(ValueError): snapshot_rows(p, m)
    p, m = fixture(); p['events'][0]['finished'] = False
    with pytest.raises(ValueError): snapshot_rows(p, m)

def test_outcome_fields_not_inputs():
    p, m = fixture(); a = snapshot_rows(p, m)[0]
    p['elements'][0]['total_points'] = -999; b = snapshot_rows(p, m)[0]
    for k in a:
        assert (isinstance(a[k], float) and np.isnan(a[k]) and np.isnan(b[k])) or a[k] == b[k]

def test_partition_unknown_categories():
    assert len(FEATURES) == len(set(FEATURES)) == 38
    p, m = fixture(); p['elements'][0]['status'] = 'unknown'
    with pytest.raises(ValueError): snapshot_rows(p, m)
