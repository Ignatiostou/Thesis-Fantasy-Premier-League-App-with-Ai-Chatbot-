"""Fixed-protocol feature-group ablation, using frozen Day 3 data."""
from pathlib import Path
import json,hashlib,shutil,time
import numpy as np
import pandas as pd
import temporal_evaluation as ev
OUT=Path('output/evaluation-ml-components');ROOT=Path('output/evaluation-day3/gw21-35')
GROUPS={'recent_points':['points_last1','points_mean3','points_mean5','points_std5'],'recent_minutes':['minutes_mean3','minutes_mean5'],'ict':['ict_mean5','threat_mean5','creativity_mean5','influence_mean5'],'season_history':['total_points_sum','goals_scored_sum','assists_sum','clean_sheets_sum','bonus_sum','points_mean_history']}
def main():
 OUT.mkdir(exist_ok=False)
 full=list(ev.FEATURES);assert sorted(sum(GROUPS.values(),[]))==sorted(full)
 frame=pd.read_parquet(ROOT/'prepared.parquet');old=pd.read_csv(ROOT/'predictions.csv')
 protocol={'groups':GROUPS,'gameweeks':list(range(21,36)),'seed':42,'design':'drop one group at a time from all three estimators; fixed parameters and identical populations; no tuning','source_hashes':{n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ['prepared.parquet','predictions.csv','report.json']},'features':full}
 (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2));shutil.copy2(Path(__file__),OUT/'run_components.py');shutil.copy2(Path(ev.__file__),OUT/'temporal_evaluation.py')
 for name,drop in [('full',[])]+list(GROUPS.items()):
  ev.FEATURES=[f for f in full if f not in drop];pred=[];reports=[];start=time.time()
  for gw in range(21,36):
   p,r=ev.evaluate_fold(frame,'2025-26',gw);pred.append(p);reports.append(r)
  d=pd.concat(pred,ignore_index=True)
  assert d[['season','player_id','gameweek']].equals(old[['season','player_id','gameweek']])
  if name=='full':
   for c in ['conditional_points','participation','minutes','overall_points']:assert np.allclose(d[c],old[c],rtol=1e-6,atol=1e-6),c
  d.to_csv(OUT/f'{name}_predictions.csv',index=False)
  (OUT/f'{name}_report.json').write_text(json.dumps({'features':ev.FEATURES,'folds':reports,'elapsed_seconds':time.time()-start},indent=2))
  print(name,'complete',round(time.time()-start,1),'seconds',flush=True)
 ev.FEATURES=full
if __name__=='__main__':main()
