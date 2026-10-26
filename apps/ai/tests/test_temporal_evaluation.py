import sys
from pathlib import Path
import numpy as np
import pandas as pd
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'evaluation'))
from temporal_evaluation import prepare, FEATURES, split_fold


def fixture():
    rows=[]
    for season in ['2025-26','2026-27']:
        for player in range(25):
            for gw in range(1,13):
                rows.append(dict(season=season,player_id=player,gameweek=gw,total_points=float(gw),minutes=90.,goals_scored=0.,assists=0.,clean_sheets=1.,bonus=0.,ict_index=float(gw),threat=float(gw),creativity=float(gw),influence=float(gw)))
    return pd.DataFrame(rows)


def test_target_and_future_outcomes_cannot_change_target_features():
    raw=fixture();before=prepare(raw)
    modified=raw.copy();mask=(modified.season=='2025-26')&(modified.gameweek>=8)
    for col in ['total_points','minutes','goals_scored','assists','clean_sheets','bonus','ict_index','threat','creativity','influence']:
        modified.loc[mask,col]=999.
    after=prepare(modified)
    select=(before.season=='2025-26')&(before.gameweek<=8)
    pd.testing.assert_frame_equal(before.loc[select,FEATURES],after.loc[select,FEATURES])
    # These statistics must include t-1, not stop at t-2.
    row=before[(before.season=='2025-26')&(before.player_id==0)&(before.gameweek==8)].iloc[0]
    assert row.points_last1==7
    assert row.baseline_points==5
    assert row.actual_points==8


def test_seasons_do_not_share_history_and_minimum_history_is_past_only():
    prepared=prepare(fixture())
    for season in prepared.season.unique():
        g=prepared[prepared.season==season]
        assert not g[g.gameweek<6].eligible.any()
        assert g[g.gameweek==6].eligible.all()
        assert g[g.gameweek==6].points_mean_history.eq(3).all()


def test_missing_outcomes_are_not_negative_labels_and_break_history():
    raw=fixture();raw.loc[(raw.season=='2025-26')&(raw.player_id==0)&(raw.gameweek==7),'minutes']=np.nan
    f=prepare(raw);g=f[(f.season=='2025-26')&(f.player_id==0)]
    assert pd.isna(g[g.gameweek==7].actual_played.iloc[0])
    assert not g[g.gameweek.between(7,12)].eligible.any()


def test_calendar_gap_does_not_become_next_gameweek():
    raw=fixture();raw=raw[~((raw.season=='2025-26')&(raw.player_id==0)&(raw.gameweek==7))]
    g=prepare(raw);g=g[(g.season=='2025-26')&(g.player_id==0)]
    assert not g[g.gameweek.between(7,12)].eligible.any()


def test_duplicate_keys_fail():
    raw=fixture()
    with pytest.raises(ValueError,match='Duplicate'):
        prepare(pd.concat([raw,raw.iloc[:1]]))


def test_fold_has_strict_target_order_and_one_season():
    f=prepare(fixture());tr,te=split_fold(f,'2025-26',11)
    assert tr.gameweek.max()==10
    assert te.gameweek.unique().tolist()==[11]
    assert tr.season.unique().tolist()==['2025-26']
    assert not set(zip(tr.player_id,tr.round_key)) & set(zip(te.player_id,te.round_key))


def test_incomplete_tail_not_included_and_order_invariant():
    raw=fixture();raw.loc[(raw.gameweek==12),'total_points']=np.nan
    a=prepare(raw);b=prepare(raw.sample(frac=1,random_state=1))
    pd.testing.assert_frame_equal(a,b)
    assert not a[a.gameweek>=12].eligible.any()


def test_aggregate_minutes_preserved_and_conditional_baseline_uses_qualifying_past():
    raw=fixture();mask=(raw.season=='2025-26')&(raw.player_id==0)
    raw.loc[mask&(raw.gameweek==6),'minutes']=180
    raw.loc[mask&(raw.gameweek==5),'minutes']=0
    f=prepare(raw);g=f[(f.season=='2025-26')&(f.player_id==0)]
    row=g[g.gameweek==6].iloc[0]
    assert row.actual_minutes==180
    assert row.observed_minutes_above90
    assert row.baseline_conditional==2.5
