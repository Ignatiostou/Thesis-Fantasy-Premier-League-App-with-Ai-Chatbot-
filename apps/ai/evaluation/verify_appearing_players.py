"""Independent row-selection and arithmetic checks for appearance diagnostics."""
from pathlib import Path
import json
import numpy as np
import pandas as pd
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/evaluation-playing-players'
checks=[]
for season,source in [('2025-26','evaluation-enriched-gw21-38'),('2026-27','evaluation-cross-season-2026-27')]:
    original=pd.read_csv(ROOT/'output'/source/'full_predictions.csv')
    expected=original[original.actual_minutes>0].sort_values(['player_id','gameweek']).reset_index(drop=True)
    dest=OUT/season
    actual=pd.read_csv(dest/'selected_predictions.csv').sort_values(['player_id','gameweek']).reset_index(drop=True)
    keys=['season','player_id','gameweek']
    pd.testing.assert_frame_equal(expected[keys],actual[keys])
    cols=['actual_minutes','actual_points','actual_played','overall_points','conditional_points','participation','minutes']
    np.testing.assert_allclose(expected[cols],actual[cols],rtol=1e-12,atol=1e-12)
    m=pd.read_csv(dest/'cohort_comparison.csv').set_index('cohort').loc['Minutes > 0']
    assert len(expected)==m['n']
    assert (expected.actual_points==0).sum()==m.zero_points
    assert (expected.actual_points<0).sum()==m.negative_points
    for col,target in [('overall_points','actual_points'),('minutes','actual_minutes')]:
        np.testing.assert_allclose(np.abs(expected[col].to_numpy()-expected[target].to_numpy()).mean(),m[col])
    qualified=expected.actual_minutes>=30
    np.testing.assert_allclose(np.abs(expected.loc[qualified,'conditional_points']-expected.loc[qualified,'actual_points']).mean(),m.conditional_points)
    assert set(p.stem for p in (dest/'players').glob('*.png'))==set(expected.player_id.astype(str))
    assert len(list(dest.glob('*.png')))==14
    bins=pd.read_csv(dest/'calibration_bins.csv')
    assert (bins.groupby('model').n.sum()==len(expected)).all()
    positions=pd.read_csv(dest/'position_metrics.csv')
    assert positions.n.sum()==len(expected)
    np.testing.assert_allclose(np.average(positions.overall_points,weights=positions.n),m.overall_points)
    diff=pd.read_csv(dest/'paired_gameweek_differences.csv')
    z=expected.assign(delta=np.abs(expected.overall_points-expected.actual_points)-np.abs(expected.baseline_points-expected.actual_points))
    ref=z.groupby('gameweek').delta.mean()
    saved=diff[(diff.task=='overall_points')&(diff.comparator=='baseline_points')].set_index('gameweek').difference
    np.testing.assert_allclose(ref.sort_index(),saved.sort_index(),atol=1e-12)
    checks.append({'season':season,'status':'PASS','rows':len(expected),'players':int(expected.player_id.nunique()),'aggregate_figures':14,'position_figures':4})
(OUT/'verification.json').write_text(json.dumps(checks,indent=2))
print(json.dumps(checks,indent=2))
