"""Append GW36-38 forecasts after verifying the old experiment is unchanged."""
from pathlib import Path
import json,shutil,time,hashlib
import numpy as np
import pandas as pd
import temporal_evaluation as ev
from run_enriched import FEATURES,GROUPS

OUT=Path('output/evaluation-enriched-gw21-38')
OLD=Path('output/evaluation-enriched')
CROSS=Path('output/evaluation-cross-season-2026-27')
KEYS=['season','player_id','gameweek']

def main():
 OUT.mkdir(exist_ok=False)
 shutil.copy2(CROSS/'input_snapshot.parquet',OUT/'input_snapshot.parquet')
 raw=pd.read_parquet(OUT/'input_snapshot.parquet');raw=raw[raw.season.eq('2025-26')]
 meta=pd.read_parquet(CROSS/'training_metadata.parquet')
 frame=ev.prepare(raw).merge(meta,on=KEYS,how='left',validate='one_to_one',indicator=True)
 missing=frame[frame.eligible & frame._merge.ne('both')]
 assert len(missing)==0
 frame=frame.drop(columns='_merge');frame.to_parquet(OUT/'prepared.parquet',index=False)
 prior=pd.read_parquet(OLD/'prepared.parquet')
 a=frame[frame.gameweek.le(35)].sort_values(KEYS).reset_index(drop=True)
 b=prior[prior.gameweek.le(35)].sort_values(KEYS).reset_index(drop=True)
 pd.testing.assert_frame_equal(a[KEYS+['eligible']],b[KEYS+['eligible']])
 for c in FEATURES+['actual_points','actual_minutes','actual_played','baseline_points','baseline_minutes','baseline_minutes_last','baseline_conditional','baseline_played']:
  assert np.allclose(a[c],b[c],equal_nan=True),c
 protocol=json.loads((OLD/'protocol.json').read_text())
 protocol.update(evaluation_gameweeks=list(range(21,39)),design='Extend existing walk-forward experiment with GW36-38. Old predictions retained after exact feature/label equivalence checks. Same hyperparameters and seed; no tuning.',previous_experiment=str(OLD),old_features_labels_equal=True,new_fits=99,total_equivalent_fits=594,labels={'overall_points':'Risk-adjusted points','conditional_points':'Conditional points'},input_sha256=hashlib.sha256((OUT/'input_snapshot.parquet').read_bytes()).hexdigest())
 protocol['sources']+= [s for s in json.loads((CROSS/'sources.json').read_text()) if s['season']=='2025-26']
 (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2))
 shutil.copy2(CROSS/'verification.json',OUT/'source-outcome-verification.json')
 configs=[('reduced_matched',list(ev.FEATURES)),('full',FEATURES)]+[('without_'+n,[f for f in FEATURES if f not in group]) for n,group in GROUPS.items()]
 for name,features in configs:
  start=time.time();ev.FEATURES=features;pred=[pd.read_csv(OLD/f'{name}_predictions.csv')];reports=[]
  for gw in range(36,39):
   d,r=ev.evaluate_fold(frame,'2025-26',gw);pred.append(d);reports.append(r)
  joined=pd.concat(pred,ignore_index=True)
  assert set(joined.gameweek)==set(range(21,39)) and not joined.duplicated(KEYS).any()
  joined.to_csv(OUT/f'{name}_predictions.csv',index=False)
  oldreport=json.loads((OLD/f'{name}_report.json').read_text())
  oldreport['folds']+=reports;oldreport['extension_seconds']=time.time()-start
  (OUT/f'{name}_report.json').write_text(json.dumps(oldreport,indent=2))
  print(name,'complete',len(joined),'rows',round(time.time()-start,1),'seconds',flush=True)
 for source in [Path(__file__),Path(ev.__file__),Path('apps/ai/evaluation/run_enriched.py')]:shutil.copy2(source,OUT/source.name)

if __name__=='__main__':main()
