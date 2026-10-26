"""Characterisation tests: recorded limitations are not assertions of good design."""
import sys, ast, json
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'apps/ai/evaluation'))
from day7_fixtures import production_helpers, OUT

def test_calendar_window_excludes_later_gameweek():
    h=production_helpers(); f=pd.DataFrame([dict(player_id=1,gameweek=g,fdr=d,is_home=True) for g,d in [(21,2),(22,3),(23,4),(24,5)]])
    p=h['build_fixture_features'](pd.Series([1]),f,21).iloc[0]
    assert p.next_gw_fdr==2 and p.avg_fdr_next3==3

def test_blank_is_neutral_not_zero_and_horizon_ignores_fixture_count():
    h=production_helpers();p=h['build_fixture_features'](pd.Series([1]),pd.DataFrame(),21).iloc[0]
    assert p.next_gw_fdr==3 and p.avg_fdr_next3==3
    assert h['project_multi_gw'](4,3,3)==(12,19)

def test_double_uses_first_fdr_and_changes_if_equal_gw_rows_reverse():
    h=production_helpers();f=pd.DataFrame([dict(player_id=1,gameweek=21,fdr=d,is_home=True) for d in [2,5]])
    a=h['build_fixture_features'](pd.Series([1]),f,21).iloc[0]
    b=h['build_fixture_features'](pd.Series([1]),f.iloc[::-1],21).iloc[0]
    assert a.next_gw_fdr==2 and b.next_gw_fdr==5
    assert a.avg_fdr_next3==b.avg_fdr_next3==3.5
    assert h['project_multi_gw'](4,a.avg_fdr_next3,a.next_gw_fdr)!=h['project_multi_gw'](4,b.avg_fdr_next3,b.next_gw_fdr)

def test_training_shift_rolling_is_not_forward_three_round_mean():
    source=(ROOT/'apps/ai/features/player_features.py').read_text(encoding='utf-8')
    node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='_add_fixture_features')
    scope={'pd':pd,'FDR_NEUTRAL':3}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'<production-training-fixtures>','exec'),scope)
    frame=pd.DataFrame(dict(player_id=[1]*5,fixture_fdr=[1,2,3,4,5],was_home=[True]*5))
    actual=scope['_add_fixture_features'](frame).iloc[2].avg_fdr_next3
    assert actual==3 and actual!=(4+5)/2

def test_saved_revisions_precede_metadata_and_deadline():
    manifests=json.loads((OUT/'provenance.json').read_text())
    assert [m['gameweek'] for m in manifests]==list(range(21,36))
    for m in manifests:assert pd.Timestamp(m['revision_time'])<pd.Timestamp(m['metadata_capture'])<pd.Timestamp(m['deadline'])
