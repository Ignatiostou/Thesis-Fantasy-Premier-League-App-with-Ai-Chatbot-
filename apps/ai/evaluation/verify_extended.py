"""Check preserved folds, new fold chronology and 18-round analysis integrity."""
import json,hashlib,shutil,importlib.util
from pathlib import Path
import numpy as np
import pandas as pd
import temporal_evaluation as ev
from extend_enriched import OUT,OLD,KEYS,FEATURES,GROUPS
from ml_uncertainty import interval,loss

def main():
 frame=pd.read_parquet(OUT/'prepared.parquet');checks={};full=pd.read_csv(OUT/'full_predictions.csv')
 assert set(full.gameweek)==set(range(21,39)) and len(full)==14476
 assert not full.duplicated(KEYS).any()
 basecols=['actual_points','actual_minutes','actual_played','baseline_points','baseline_conditional','baseline_minutes','baseline_minutes_last','baseline_played']
 for name in ['full','reduced_matched']+['without_'+g for g in GROUPS]:
  new=pd.read_csv(OUT/f'{name}_predictions.csv');old=pd.read_csv(OLD/f'{name}_predictions.csv')
  pd.testing.assert_frame_equal(new[new.gameweek.le(35)].reset_index(drop=True),old,check_exact=False,rtol=1e-13,atol=1e-13)
  pd.testing.assert_frame_equal(new[KEYS+basecols],full[KEYS+basecols])
  assert np.isfinite(new.select_dtypes('number')).all().all()
  report=json.loads((OUT/f'{name}_report.json').read_text());assert len(report['folds'])==18
  for fold in report['folds']:
   assert fold['training_target_gameweeks'][1]<fold['target_gameweek']
  for gw in [36,37,38]:
   train,test=ev.split_fold(frame,'2025-26',gw)
   assert train.gameweek.max()==gw-1 and test.gameweek.eq(gw).all()
 checks['all_11_configurations_preserve_old_predictions_and_match_labels']=True
 checks['all_18_folds_train_strictly_before_target']=True
 # Target/future labels cannot enter training for the last fold.
 changed=frame.copy();changed.loc[changed.gameweek.ge(38),'actual_points']=999
 original_train,_=ev.split_fold(frame,'2025-26',38);changed_train,_=ev.split_fold(changed,'2025-26',38)
 pd.testing.assert_frame_equal(original_train,changed_train)
 ev.FEATURES=FEATURES;repeated,_=ev.evaluate_fold(frame,'2025-26',38)
 saved=full[full.gameweek.eq(38)].reset_index(drop=True)
 for c in ['overall_points','conditional_points','participation','minutes']:assert np.allclose(saved[c],repeated[c],atol=1e-8)
 checks['GW38_full_model_independently_reproduced']=True
 # The generalised bootstrap must reproduce the original 15-round procedure.
 archived=OLD/'analysis/ml_uncertainty.py'
 spec=importlib.util.spec_from_file_location('old_intervals',archived);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 for n in [15,18]:
  assert interval(np.ones(n))['ci95_low']==1
  x=np.linspace(-1,2,n);a=interval(x);b=interval(-x)
  assert np.isclose(a['ci95_low'],-b['ci95_high'])
  if n==15:assert a==module.interval(x)
 checks['bootstrap_15_round_regression_and_18_round_sanity']=True
 U=pd.read_csv(OUT/'analysis/comparison_uncertainty.csv')
 s=U[U.task.eq('overall_points')&U.comparator.eq('baseline_points')&U.block_length.eq(3)].iloc[0]
 baseline=full.copy();baseline['overall_points']=baseline.baseline_points
 fresh=interval(loss(full,'overall_points')-loss(baseline,'overall_points'),3,9)
 assert np.isclose(s.mean_difference,fresh['mean_difference']) and np.isclose(s.family_low,fresh['family_low'])
 assert len(U)==27 and len(pd.read_csv(OUT/'analysis/ablation_uncertainty.csv'))==108
 assert pd.read_csv(OUT/'analysis/calibration_bins.csv').groupby('method').n.sum().eq(len(full)).all()
 oldtop=pd.read_csv('output/evaluation-top-players/selected_players.csv');newtop=pd.read_csv(OUT/'top-players/selected_players.csv')
 assert set(oldtop.player_id)==set(newtop.player_id)
 t=pd.read_csv(OUT/'top-players/player_gameweek_results.csv');assert len(t)==810 and t.groupby('player_id').size().eq(18).all()
 checks['same_45_top_players_810_rows_all_18_rounds']=True
 checks['metrics_bootstrap_and_calibration_independently_verified']=True
 checks['n']=len(full);checks['new_rows']=int(full.gameweek.ge(36).sum());checks['status']='PASS'
 (OUT/'verification.json').write_text(json.dumps(checks,indent=2))
 shutil.copy2(__file__,OUT/Path(__file__).name)
 (OUT/'artifact_hashes.json').write_text(json.dumps({str(p.relative_to(OUT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.rglob('*') if p.is_file() and p.name!='artifact_hashes.json'},indent=2))
 print(json.dumps(checks,indent=2))

if __name__=='__main__':main()
