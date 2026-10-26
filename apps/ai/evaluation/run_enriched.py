"""Enriched pre-deadline metadata experiment; separate from production."""
from pathlib import Path
import json,gzip,hashlib,shutil,time
from datetime import datetime
import numpy as np
import pandas as pd
import temporal_evaluation as ev
ROOT=Path('output/evaluation-day3/gw21-35');OUT=Path('output/evaluation-enriched');CAP=Path('output/historical-data-research/captures')
OLD=list(ev.FEATURES)
GROUPS={'recent_points':['points_last1','points_mean3','points_mean5','points_std5'],'recent_minutes':['minutes_mean3','minutes_mean5'],'ict':['ict_mean5','threat_mean5','creativity_mean5','influence_mean5'],'season_history':['total_points_sum','goals_scored_sum','assists_sum','clean_sheets_sum','bonus_sum','points_mean_history'],'market':['snapshot_price','snapshot_ownership'],'availability':['status_'+c for c in ['a','d','i','n','s','u']]+['snapshot_chance','snapshot_chance_missing'],'api_form':['snapshot_form'],'position':['position_'+str(i) for i in range(1,5)],'team_strength':['team_'+c for c in ['strength','strength_overall_home','strength_overall_away','strength_attack_home','strength_attack_away','strength_defence_home','strength_defence_away']]}
FEATURES=sum(GROUPS.values(),[])
def snapshot_rows(payload,manifest):
 gw=manifest['event'];e=next(x for x in payload['events'] if x['id']==gw)
 cap=datetime.fromisoformat(manifest['captured_at'].replace('Z','+00:00'));deadline=datetime.fromisoformat(e['deadline_time'].replace('Z','+00:00'))
 if not cap<deadline or not e['is_next']:raise ValueError('Snapshot not before intended next deadline')
 if any(not x['finished'] for x in payload['events'] if x['id']<gw):raise ValueError('Earlier outcomes incomplete')
 if manifest['event_deadline']!=e['deadline_time']:raise ValueError('Deadline mismatch')
 teams={x['id']:x for x in payload['teams']};rows=[]
 for el in payload['elements']:
  if el['status'] not in ['a','d','i','n','s','u'] or el['element_type'] not in [1,2,3,4]:raise ValueError('Unknown categorical value')
  chance=el['chance_of_playing_next_round']
  if chance is not None and not 0<=float(chance)<=100:raise ValueError('Invalid chance')
  row={'season':'2025-26','gameweek':gw,'player_id':el['id'],'player_code':el['code'],'snapshot_name':el['web_name'],'snapshot_position':el['element_type'],'snapshot_team':el['team'],'snapshot_age_hours':(deadline-cap).total_seconds()/3600,'snapshot_price':float(el['now_cost'])/10,'snapshot_ownership':float(el['selected_by_percent'])/100,'snapshot_form':float(el['form']),'snapshot_chance':np.nan if chance is None else float(chance)/100,'snapshot_chance_missing':float(chance is None)}
  row.update({'status_'+c:float(el['status']==c) for c in ['a','d','i','n','s','u']});row.update({'position_'+str(i):float(el['element_type']==i) for i in range(1,5)})
  row.update({c:float(teams[el['team']][c[5:]]) for c in GROUPS['team_strength']});rows.append(row)
 return rows

def build():
 OUT.mkdir(exist_ok=False);metadata=[];audit=[]
 for path in sorted(CAP.glob('*/bootstrap-static.json.gz')):
  m=json.loads((path.parent/'manifest.json').read_text());b=gzip.decompress(path.read_bytes());assert hashlib.sha256(b).hexdigest()==m['files'][0]['sha256'];p=json.loads(b);rows=snapshot_rows(p,m);metadata.extend(rows)
  audit.append({'gameweek':m['event'],'captured_at':m['captured_at'],'deadline':m['event_deadline'],'sha256':hashlib.sha256(b).hexdigest(),'n':len(rows),'source':m['backfill']['source']})
 meta=pd.DataFrame(metadata);assert sorted(meta.gameweek.unique())==list(range(1,37));assert not meta.duplicated(['season','player_id','gameweek']).any();assert meta.groupby('player_id').player_code.nunique().max()==1
 meta.to_parquet(OUT/'snapshot_features.parquet',index=False)
 frame=pd.read_parquet(ROOT/'prepared.parquet');frame=frame[frame.season=='2025-26'].copy();frame=frame.merge(meta,on=['season','player_id','gameweek'],how='left',validate='one_to_one',indicator=True)
 orig=frame.eligible.copy();frame['eligible']=frame.eligible&frame['_merge'].eq('both');lost=frame[orig&~frame.eligible&frame.gameweek.le(35)]
 lost[['season','player_id','gameweek']].to_csv(OUT/'excluded_missing_snapshot.csv',index=False)
 available=frame[frame.eligible&frame.gameweek.le(35)]
 assert available[[x for x in FEATURES if x!='snapshot_chance']].notna().all().all()
 frame.drop(columns='_merge').to_parquet(OUT/'prepared.parquet',index=False)
 protocol={'groups':GROUPS,'features':FEATURES,'feature_count':len(FEATURES),'evaluation_gameweeks':list(range(21,36)),'missing_snapshot_exclusions':len(lost),'design':'full enriched plus nine group removals; reduced comparator on matched rows; fixed original hyperparameters and seed; no tuning','missing_chance':'NaN plus missingness indicator, train-only median imputation; no assumption that null means zero or certain participation','excluded':'Upcoming fixtures, opponent context and future FDR remain unverified and excluded. Team IDs and player IDs are metadata, not numeric features.','scope':'retrospective archived-snapshot study, not untouched holdout or exact production configuration','sources':audit,'original_prepared_sha256':hashlib.sha256((ROOT/'prepared.parquet').read_bytes()).hexdigest(),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2));shutil.copy2(__file__,OUT/'run_enriched.py');shutil.copy2(ev.__file__,OUT/'temporal_evaluation.py')
 print('Built',len(FEATURES),'features; excluded',len(lost),'previously eligible rows',flush=True)
 return frame

def main():
 frame=build()
 for name,features in [('reduced_matched',OLD),('full',FEATURES)]+[('without_'+n,[x for x in FEATURES if x not in group]) for n,group in GROUPS.items()]:
  ev.FEATURES=features;pred=[];reports=[];start=time.time()
  for gw in range(21,36):
   p,r=ev.evaluate_fold(frame,'2025-26',gw);pred.append(p);reports.append(r)
  d=pd.concat(pred,ignore_index=True);d.to_csv(OUT/f'{name}_predictions.csv',index=False);(OUT/f'{name}_report.json').write_text(json.dumps({'features':features,'folds':reports,'seconds':time.time()-start},indent=2))
  if name=='reduced_matched':
   old=pd.read_csv(ROOT/'predictions.csv')
   if d[['season','player_id','gameweek']].equals(old[['season','player_id','gameweek']]) and json.loads((OUT/'protocol.json').read_text())['missing_snapshot_exclusions']==0:
    for c in ['conditional_points','participation','minutes','overall_points']:assert np.allclose(d[c],old[c],atol=1e-6,rtol=1e-6)
  print(name,'complete',round(time.time()-start,1),'seconds',flush=True)
 ev.FEATURES=OLD
if __name__=='__main__':main()
