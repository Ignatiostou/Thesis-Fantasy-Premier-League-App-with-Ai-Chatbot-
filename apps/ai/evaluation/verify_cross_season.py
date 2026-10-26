"""Independent provenance, identity, chronology and saved-prediction checks."""
import hashlib,json,itertools,shutil
import numpy as np
import pandas as pd
import joblib
from cross_season import OUT,FEATURES,GROUPS,build_test,save_json

def main():
    raw=pd.read_parquet(OUT/'input_snapshot.parquet')
    train=pd.read_parquet(OUT/'train.parquet');test=pd.read_parquet(OUT/'test.parquet')
    old=pd.read_parquet(OUT/'training_metadata.parquet');new=pd.read_parquet(OUT/'test_metadata.parquet')
    checks={}
    assert train.season.eq('2025-26').all() and train.gameweek.max()==38
    assert test.season.eq('2026-27').all() and set(test.gameweek)=={1,2,3,4}
    assert not train.duplicated(['player_id','gameweek']).any() and not test.duplicated(['player_code','gameweek']).any()
    checks['disjoint_seasons_and_unique_keys']=True
    for meta in (old,new):
        m=meta[['player_id','player_code']].drop_duplicates()
        assert not m.player_id.duplicated().any() and not m.player_code.duplicated().any()
    remapped=test[test.returning_player].player_id.ne(test[test.returning_player].prior_season_player_id).sum()
    checks['stable_codes_used_numeric_id_differences_in_test_rows']=int(remapped)
    # Independent current and final-season bootstrap cumulative totals.
    totals_audit=[]
    for season,filename in [('2025-26','2025-26-final-bootstrap-outcome-check-only.json'),('2026-27','current-bootstrap-outcome-check-only.json')]:
        data=json.loads((OUT/filename).read_text());official=pd.DataFrame(data['elements']).set_index('id')
        observed=raw[raw.season.eq(season)].groupby('player_id')[['total_points','minutes']].sum()
        both=observed.join(official[['total_points','minutes']],rsuffix='_official')
        bad=both[(both.total_points!=both.total_points_official)|(both.minutes!=both.minutes_official)]
        bad.to_csv(OUT/f'{season}_outcome_mismatches.csv')
        assert len(bad)==0,(season,len(bad))
        totals_audit.append(dict(season=season,players=len(both),mismatches=0))
    checks['independent_season_totals']=totals_audit
    # Validate that each new-season archive was committed/fetched before deadline,
    # and that its already accumulated points/minutes match earlier outcomes.
    sources=json.loads((OUT/'sources.json').read_text());archive=[]
    for s in sources:
        if s['season']!='2026-27':continue
        gw=s['gameweek'];p=OUT/'captures'/f'2026-27-GW{gw}.json'
        assert hashlib.sha256(p.read_bytes()).hexdigest()==s['sha256']
        assert pd.Timestamp(s['committed_at'])<pd.Timestamp(s['deadline'])
        assert pd.Timestamp(s['fetch_timestamp'])<pd.Timestamp(s['deadline'])
        data=json.loads(p.read_text());els=pd.DataFrame(data['elements']).set_index('id')
        before=raw[raw.season.eq('2026-27') & raw.gameweek.lt(gw)].groupby('player_id')[['total_points','minutes']].sum()
        both=els[['total_points','minutes']].join(before,rsuffix='_observed').fillna(0)
        bad=both[(both.total_points!=both.total_points_observed)|(both.minutes!=both.minutes_observed)]
        bad.to_csv(OUT/f'GW{gw}_prior_snapshot_mismatches.csv')
        if gw==1:
            # Preseason bootstrap totals are carried from earlier competition,
            # not current-season GW0 results. They are not model inputs.
            assert test.loc[test.gameweek.eq(1),'total_points_sum'].eq(0).all()
        else:
            assert len(bad)==0,(gw,len(bad))
        archive.append(dict(gameweek=gw,players=len(els),prior_total_mismatches=len(bad),note='GW1 preseason cumulative fields are not current-season totals and are unused' if gw==1 else 'Exact match to completed earlier rounds',fetch_age_hours=(pd.Timestamp(s['deadline'])-pd.Timestamp(s['fetch_timestamp'])).total_seconds()/3600))
    checks['predeadline_archives']=archive
    # Mutating target and future outcomes must not alter target-time inputs.
    sample_codes=list(test[test.returning_player].player_code.unique()[:4])+list(test[~test.returning_player].player_code.unique()[:4])
    smallmeta=new[new.player_code.isin(sample_codes)]
    original=build_test(raw,old,smallmeta)
    changed=raw.copy();mask=changed.season.eq('2026-27') & changed.gameweek.ge(3)
    for c in ['total_points','minutes','goals_scored','assists','clean_sheets','bonus','ict_index','threat','creativity','influence']:
        changed[c]=changed[c].astype(float)
        changed.loc[mask,c]=999
    perturbed=build_test(changed,old,smallmeta)
    pd.testing.assert_frame_equal(original.loc[original.gameweek.le(3),FEATURES],perturbed.loc[perturbed.gameweek.le(3),FEATURES])
    checks['target_and_future_outcome_perturbation']=True
    # Independently verify GW1 carryover through code, and season-total reset.
    for _,r in test[test.gameweek.eq(1)&test.returning_player].head(20).iterrows():
        prior=raw[raw.season.eq('2025-26') & raw.player_id.eq(r.prior_season_player_id)].set_index('gameweek').reindex(range(34,39))
        assert np.isclose(r.points_mean5,prior.total_points.mean(),equal_nan=True)
        assert r.total_points_sum==0 and pd.isna(r.points_mean_history)
    checks['stable_identity_gw1_history_and_reset']=True
    for name in ['full','reduced']+['without_'+g for g in GROUPS]:
        d=pd.read_parquet(OUT/f'{name}_predictions.parquet');bundle=joblib.load(OUT/'models'/f'{name}.joblib')
        pd.testing.assert_frame_equal(d[['player_code','gameweek']],test[['player_code','gameweek']])
        assert np.isfinite(d[['conditional_points','participation','overall_points','minutes']]).all().all()
        for task,model in bundle['estimators'].items():
            selected=test.iloc[::97]
            result=model.predict_proba(selected[bundle['features']])[:,1] if task=='participation' else model.predict(selected[bundle['features']])
            result=np.clip(result,0,1) if task=='participation' else np.maximum(result,0)
            assert np.allclose(result,d.loc[selected.index,task])
            fit=train[train.actual_played.eq(1)] if task=='conditional_points' else train
            medians=fit[bundle['features']].median().to_numpy()
            assert np.allclose(model.named_steps['imputer'].statistics_,medians,equal_nan=True)
    checks['all_11_saved_models_reproduce_predictions_and_training_only_imputers']=True
    full=pd.read_parquet(OUT/'full_predictions.parquet');stats=pd.read_csv(OUT/'metrics.csv');en=stats[stats.cohort.eq('enriched')].set_index('task')
    assert np.isclose(en.loc['overall_points','model'],np.abs(full.overall_points-full.actual_points).mean())
    assert np.isclose(en.loc['participation','model'],np.square(full.participation-full.actual_played).mean())
    excluded=pd.read_csv(OUT/'excluded_no_predeadline_metadata.csv')
    assert len(full)+len(excluded)==len(raw[raw.season.eq('2026-27')&raw.gameweek.le(4)])
    checks['independent_metrics_and_coverage']=True
    checks['test_input_missing_counts']={k:int(v) for k,v in test[FEATURES].isna().sum().items() if v}
    checks['status']='PASS'
    save_json(OUT/'verification.json',checks)
    for name in ['cross_season.py','report_cross_season.py','verify_cross_season.py','run_enriched.py']:
        shutil.copy2(__import__('pathlib').Path(__file__).parent/name,OUT/name)
    save_json(OUT/'artifact_hashes.json',{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.is_file() and p.name!='artifact_hashes.json'})
    print(json.dumps(checks,indent=2))

if __name__=='__main__':main()
