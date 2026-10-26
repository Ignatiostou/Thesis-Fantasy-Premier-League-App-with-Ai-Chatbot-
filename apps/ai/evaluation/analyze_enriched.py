"""Summaries, diagnostics and paired inference for the enriched experiment."""
from pathlib import Path
import json,hashlib,shutil
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import roc_auc_score,brier_score_loss
from matplotlib.ticker import MaxNLocator
from ml_uncertainty import interval,loss
ROOT=Path('output/evaluation-enriched');OUT=ROOT/'analysis'
TASKS=['conditional_points','overall_points','participation','minutes']
KEYS=['season','player_id','gameweek']
def metric(d,task):
 z=d[d.actual_played==1] if task=='conditional_points' else d
 y=z.actual_played if task=='participation' else z.actual_minutes if task=='minutes' else z.actual_points
 e=z[task]-y
 return dict(n=len(z),loss=float((e**2 if task=='participation' else abs(e)).mean()),rmse=None if task=='participation' else float(np.sqrt((e**2).mean())),bias=float(e.mean()),mean_gameweek_loss=float(loss(d,task).mean()))
def stats(z):
 return dict(n=len(z),points_mae=float(abs(z.overall_points-z.actual_points).mean()),points_baseline_mae=float(abs(z.baseline_points-z.actual_points).mean()),minutes_mae=float(abs(z.minutes-z.actual_minutes).mean()),minutes_baseline_mae=float(abs(z.baseline_minutes-z.actual_minutes).mean()),minutes_last_mae=float(abs(z.baseline_minutes_last-z.actual_minutes).mean()),brier=float(((z.participation-z.actual_played)**2).mean()),points_bias=float((z.overall_points-z.actual_points).mean()))
def main():
 OUT.mkdir(exist_ok=True);p=json.loads((ROOT/'protocol.json').read_text());full=pd.read_csv(ROOT/'full_predictions.csv');reduced=pd.read_csv(ROOT/'reduced_matched_predictions.csv');frames={'full':full,'reduced_matched':reduced}
 for n in p['groups']:frames['without_'+n]=pd.read_csv(ROOT/f'without_{n}_predictions.csv')
 summary=[]
 for name,d in frames.items():
  assert not d.duplicated(KEYS).any() and d[KEYS].equals(full[KEYS])
  for c in ['actual_points','actual_minutes','actual_played','baseline_points','baseline_conditional','baseline_minutes','baseline_minutes_last','baseline_played']:assert d[c].equals(full[c]),(name,c)
  assert np.isfinite(d.select_dtypes('number')).all().all()
  for task in TASKS:summary.append({'configuration':name,'task':task,**metric(d,task)})
 S=pd.DataFrame(summary);S.to_csv(OUT/'model_summary.csv',index=False)
 comparisons=[];folds=[]
 for task,base in [('conditional_points','baseline_conditional'),('overall_points','baseline_points'),('participation','baseline_played'),('minutes','baseline_minutes'),('minutes','baseline_minutes_last')]:
  b=full.copy();b[task]=b[base];delta=loss(full,task)-loss(b,task)
  for length in [2,3,5]:comparisons.append({'task':task,'comparator':base,'block_length':length,**interval(delta,length,9)})
  folds.extend({'task':task,'comparator':base,'gameweek':i+21,'difference':float(v)} for i,v in enumerate(delta))
 for task in TASKS:
  delta=loss(full,task)-loss(reduced,task)
  for length in [2,3,5]:comparisons.append({'task':task,'comparator':'reduced_matched','block_length':length,**interval(delta,length,9)})
  folds.extend({'task':task,'comparator':'reduced_matched','gameweek':i+21,'difference':float(v)} for i,v in enumerate(delta))
 pd.DataFrame(comparisons).to_csv(OUT/'comparison_uncertainty.csv',index=False);pd.DataFrame(folds).to_csv(OUT/'paired_gameweek_differences.csv',index=False)
 A=[]
 for name,d in frames.items():
  if not name.startswith('without_'):continue
  for task in TASKS:
   delta=loss(d,task)-loss(full,task)
   for length in [2,3,5]:A.append({'removed_group':name[8:],'task':task,'block_length':length,**interval(delta,length,36)})
 pd.DataFrame(A).to_csv(OUT/'ablation_uncertainty.csv',index=False)
 # One-to-one as-of metadata; position is now from each target's archived snapshot.
 meta=pd.read_parquet(ROOT/'prepared.parquet');D=full.merge(meta[KEYS+['snapshot_position','snapshot_name','snapshot_age_hours','status_a','snapshot_chance_missing']],on=KEYS,validate='one_to_one')
 D['position']=D.snapshot_position.map({1:'GK',2:'DEF',3:'MID',4:'FWD'})
 D['actual_minutes_group']=pd.cut(D.actual_minutes,[-1,0,29.999,59.999,90,np.inf],labels=['0','1-29','30-59','60-90','>90'])
 D['prior_minutes_group']=pd.cut(D.baseline_minutes_last,[-1,0,29.999,59.999,90,np.inf],labels=['0','1-29','30-59','60-90','>90'])
 D['change_group']=np.where(D.actual_minutes.eq(D.baseline_minutes_last),'unchanged','changed')
 raw=pd.read_parquet(ROOT/'input_snapshot.parquet').sort_values(KEYS);raw['complete']=(raw.minutes.notna()&raw.total_points.notna()).astype(int);raw['history_count']=raw.groupby(['season','player_id']).complete.cumsum()-raw.complete
 D=D.merge(raw[KEYS+['history_count']],on=KEYS,validate='one_to_one');D['history_group']=pd.cut(D.history_count,[-1,9,19,29,np.inf],labels=['5-9','10-19','20-29','30+'])
 for col in ['gameweek','position','actual_minutes_group','prior_minutes_group','change_group','history_group','status_a','snapshot_chance_missing']:
  pd.DataFrame([{col:str(k),**stats(z)} for k,z in D.groupby(col,observed=True)]).to_csv(OUT/f'by_{col}.csv',index=False)
 cal=[];prob={}
 for name,col,df in [('enriched','participation',full),('reduced','participation',reduced),('baseline','baseline_played',full)]:
  bins=np.minimum((df[col]*10).astype(int),9)
  for b in range(10):
   z=df[bins==b];cal.append(dict(method=name,bin=b,n=len(z),predicted=float(z[col].mean()) if len(z) else None,observed=float(z.actual_played.mean()) if len(z) else None))
  prob[name]={'brier':float(brier_score_loss(df.actual_played,df[col])),'auc':float(roc_auc_score(df.actual_played,df[col])),'mean_probability':float(df[col].mean())}
 C=pd.DataFrame(cal);C.to_csv(OUT/'calibration_bins.csv',index=False)
 for name,z in C.groupby('method'):
  assert z.n.sum()==len(full);prob[name]['ece_10_bins']=float((z.n*(z.predicted-z.observed).abs()).sum()/len(full))
 for task in ['overall_points','minutes']:
  target='actual_points' if task=='overall_points' else 'actual_minutes';D.assign(error=D[task]-D[target],absolute_error=(D[task]-D[target]).abs()).sort_values('absolute_error',ascending=False).head(30).to_csv(OUT/f'largest_{task}_errors.csv',index=False)
 plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
 def save(n):plt.tight_layout();plt.savefig(OUT/n,dpi=170);plt.close()
 def gwticks():plt.gca().xaxis.set_major_locator(MaxNLocator(integer=True))  # whole gameweeks only
 MLABEL={'enriched':'production','reduced':'reduced','baseline':'baseline'}
 f=pd.read_csv(OUT/'by_gameweek.csv').set_index('gameweek');g=full.groupby('gameweek');rg=reduced.groupby('gameweek')
 plt.figure(figsize=(9,4));plt.plot(f.index,f.points_mae,label='Production');plt.plot(f.index,rg.apply(lambda z:abs(z.overall_points-z.actual_points).mean(),include_groups=False),label='Reduced');plt.plot(f.index,f.points_baseline_mae,label='Baseline');plt.xlabel('Target gameweek');plt.ylabel('Risk-adjusted points MAE');plt.legend();gwticks();save('01_points_mae.png')
 plt.figure(figsize=(9,4));plt.plot(g.actual_points.mean(),label='Actual');plt.plot(g.overall_points.mean(),label='Production');plt.plot(rg.overall_points.mean(),label='Reduced');plt.ylabel('Mean points');plt.xlabel('Target gameweek');plt.legend();gwticks();save('02_mean_points.png')
 plt.figure(figsize=(9,4));
 for c,l in [('minutes_mae','Production'),('minutes_baseline_mae','Five-round mean'),('minutes_last_mae','Previous round')]:plt.plot(f.index,f[c],label=l)
 plt.plot(f.index,rg.apply(lambda z:abs(z.minutes-z.actual_minutes).mean(),include_groups=False),label='Reduced');plt.ylabel('Minutes MAE');plt.xlabel('Target gameweek');plt.legend();gwticks();save('03_minutes_mae.png')
 fig,axes=plt.subplots(1,2,figsize=(11,4))
 for name,z in C.groupby('method'):axes[0].plot(z.predicted,z.observed,'o-',label=MLABEL.get(name,name));axes[1].plot(z.bin/10+.05,z.n,'o-',label=MLABEL.get(name,name))
 axes[0].plot([0,1],[0,1],'k--');axes[0].set(xlabel='Mean predicted probability',ylabel='Observed >=30-minute rate');axes[1].set(xlabel='Probability-bin midpoint',ylabel='Observations');axes[0].legend();save('04_calibration.png')
 plt.figure(figsize=(7,5));plt.scatter(full.actual_points,full.overall_points,s=6,alpha=.12);plt.plot([-2,25],[-2,25],'k--');plt.xlabel('Actual points');plt.ylabel('Risk-adjusted points prediction');save('05_scatter.png')
 plt.figure(figsize=(9,4));plt.hist(full.overall_points-full.actual_points,bins=60);plt.axvline(0,color='black',ls='--');plt.xlabel('Predicted - actual points');plt.ylabel('Observations');save('06_errors.png')
 pos=pd.read_csv(OUT/'by_position.csv');x=np.arange(len(pos));plt.figure(figsize=(8,4));plt.bar(x-.18,pos.points_mae,.36,label='Production');plt.bar(x+.18,pos.points_baseline_mae,.36,label='Baseline');plt.xticks(x,[f'{r.position}\nn={r.n}' for r in pos.itertuples()]);plt.ylabel('Points MAE');plt.title('Positions from pre-deadline snapshots');plt.legend();save('07_position.png')
 plt.figure(figsize=(9,4));plt.bar(f.index,f.n);plt.ylabel('Matched player-gameweek rows');plt.xlabel('Gameweek');gwticks();save('09_coverage.png')
 plt.figure(figsize=(9,4));
 for name,col,df in [('Production','participation',full),('Reduced','participation',reduced),('Baseline','baseline_played',full)]:plt.plot(sorted(df.gameweek.unique()),[roc_auc_score(z.actual_played,z[col]) for _,z in df.groupby('gameweek')],label=name)
 plt.ylim(.5,1);plt.xlabel('Gameweek');plt.ylabel('ROC-AUC');plt.legend();gwticks();save('10_auc.png')
 ar=pd.DataFrame(A);fig,axs=plt.subplots(2,2,figsize=(12,9))
 for ax,task in zip(axs.flat,TASKS):
  z=ar[(ar.task==task)&(ar.block_length==3)].reset_index(drop=True)
  for i,r in z.iterrows():ax.plot([r.ci95_low,r.ci95_high],[i,i],color='steelblue');ax.plot(r.mean_difference,i,'o',color='steelblue')
  ax.set_yticks(range(len(z)),z.removed_group);ax.axvline(0,color='grey',ls='--');ax.set_title('Risk-adjusted points' if task=='overall_points' else task.replace('_',' ').capitalize());ax.set_xlabel('Removed minus full loss (marginal 95% interval)')
 save('11_ablation_intervals.png')
 result={'n':len(full),'unique_players':int(full.player_id.nunique()),'qualifying':int(full.actual_played.sum()),'nonplayers':int(full.actual_minutes.eq(0).sum()),'above90':int(full.actual_minutes.gt(90).sum()),'probability':prob,'within2':float((full.overall_points-full.actual_points).abs().le(2).mean()),'comparisons':comparisons,'bootstrap':'100000 circular-block samples; seed 20260915; lengths 2,3,5; equal-gameweek losses; Bonferroni families 9 headline comparisons and 36 exploratory ablations; approximate retrospective intervals','source_sha256':hashlib.sha256((ROOT/'full_predictions.csv').read_bytes()).hexdigest()}
 (OUT/'summary.json').write_text(json.dumps(result,indent=2,allow_nan=False));shutil.copy2(__file__,OUT/'analyze_enriched.py');shutil.copy2('apps/ai/evaluation/ml_uncertainty.py',OUT/'ml_uncertainty.py')
 print(S[S.configuration.isin(['full','reduced_matched'])].to_string(index=False));print(json.dumps(prob,indent=2))
if __name__=='__main__':main()
