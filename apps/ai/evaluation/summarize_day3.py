from pathlib import Path
import json
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error,mean_squared_error,brier_score_loss,log_loss,f1_score
root=Path('output/evaluation-day3/gw21-35')
r=json.loads((root/'report.json').read_text());d=pd.read_csv(root/'predictions.csv')
assert len(r['folds'])==15
assert sorted(d.gameweek.unique())==list(range(21,36))
assert not d.duplicated(['season','player_id','gameweek']).any()
assert d.select_dtypes('number').apply(np.isfinite).all().all()
summary={'folds':15,'player_gameweek_rows':len(d),'unique_players':int(d.player_id.nunique()),'qualifying_rows':int(d.actual_played.sum()),'elapsed_seconds':r['elapsed_seconds'],'comparisons':{}}
specs=[('conditional_points','actual_points','conditional_points','baseline_conditional',d.actual_played==1,'mae'),('overall_points','actual_points','overall_points','baseline_points',pd.Series(True,index=d.index),'mae'),('participation','actual_played','participation','baseline_played',pd.Series(True,index=d.index),'brier'),('minutes','actual_minutes','minutes','baseline_minutes',pd.Series(True,index=d.index),'mae'),('minutes_last','actual_minutes','minutes','baseline_minutes_last',pd.Series(True,index=d.index),'mae')]
foldrows=[]
for name,target,pred,base,mask,metric in specs:
 sub=d[mask];fn=brier_score_loss if metric=='brier' else mean_absolute_error
 a=float(fn(sub[target],sub[pred]));b=float(fn(sub[target],sub[base]))
 fold=[]
 for gw,g in sub.groupby('gameweek'):
  x=float(fn(g[target],g[pred]));y=float(fn(g[target],g[base]));fold.append((x,y));foldrows.append(dict(task=name,gameweek=int(gw),n=len(g),model=x,baseline=y,difference=x-y))
 f=np.array(fold)
 v={'metric':metric,'n':len(sub),'pooled_model':a,'pooled_baseline':b,'pooled_relative_improvement_percent':100*(b-a)/b,'mean_gameweek_model':float(f[:,0].mean()),'mean_gameweek_baseline':float(f[:,1].mean()),'model_better_gameweeks':int((f[:,0]<f[:,1]).sum()),'ties':int(np.isclose(f[:,0],f[:,1],rtol=0,atol=1e-12).sum())}
 if metric=='mae':
  v['pooled_rmse_model']=float(np.sqrt(mean_squared_error(sub[target],sub[pred])));v['pooled_rmse_baseline']=float(np.sqrt(mean_squared_error(sub[target],sub[base])))
 else:
  v['pooled_f1_model']=float(f1_score(sub[target],sub[pred]>=.5));v['pooled_f1_baseline']=float(f1_score(sub[target],sub[base]>=.5));v['pooled_logloss_model']=float(log_loss(sub[target],np.clip(sub[pred],1e-6,1-1e-6),labels=[0,1]));v['pooled_logloss_baseline']=float(log_loss(sub[target],np.clip(sub[base],1e-6,1-1e-6),labels=[0,1]))
 summary['comparisons'][name]=v
summary['above90_rows']=int(d.observed_minutes_above90.sum())
(root/'summary.json').write_text(json.dumps(summary,indent=2));pd.DataFrame(foldrows).to_csv(root/'fold_comparisons.csv',index=False)
# Independently reconcile per-row pooled calculations with saved fold metrics.
for f in r['folds']:
 g=d[d.gameweek==f['target_gameweek']]
 assert np.isclose(mean_absolute_error(g.actual_points,g.overall_points),f['metrics']['overall_points']['model']['mae'])
 assert np.isclose(brier_score_loss(g.actual_played,g.participation),f['metrics']['participation']['model']['brier'])
print(json.dumps(summary,indent=2))
