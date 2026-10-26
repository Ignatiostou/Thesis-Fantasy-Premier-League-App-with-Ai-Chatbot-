"""Day 4 descriptive diagnostics; no fitting or changes to production."""
from pathlib import Path
import hashlib,json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import roc_auc_score,brier_score_loss,mean_absolute_error
ROOT=Path('output/evaluation-day3/gw21-35'); OUT=Path('output/evaluation-day4');OUT.mkdir(exist_ok=True)
D=pd.read_csv(ROOT/'predictions.csv');raw=pd.read_parquet(ROOT/'input_snapshot.parquet')
keys=['season','player_id','gameweek']
assert not D.duplicated(keys).any() and not raw.duplicated(keys).any()
D=D.merge(raw[keys+['position','web_name']],on=keys,validate='one_to_one',indicator=True)
assert D['_merge'].eq('both').all();D.drop(columns='_merge',inplace=True)
D['position']=D.position.map({1:'GK',2:'DEF',3:'MID',4:'FWD'}).fillna('Unknown')
# History counts include only complete earlier same-season observations.
h=raw.sort_values(keys).copy();h['complete']=(h.minutes.notna()&h.total_points.notna()).astype(int)
h['history_count']=h.groupby(['season','player_id']).complete.cumsum()-h.complete
D=D.merge(h[keys+['history_count']],on=keys,validate='one_to_one')
D['history_group']=pd.cut(D.history_count,[-1,9,19,29,np.inf],labels=['5-9','10-19','20-29','30+'],right=True)
D['actual_minutes_group']=pd.cut(D.actual_minutes,[-1,0,29.999,59.999,90,np.inf],labels=['0','1-29','30-59','60-90','>90'])
D['prior_minutes_group']=pd.cut(D.baseline_minutes_last,[-1,0,29.999,59.999,90,np.inf],labels=['0','1-29','30-59','60-90','>90'])
D['points_error']=D.overall_points-D.actual_points;D['minutes_error']=D.minutes-D.actual_minutes
D['minutes_change']=D.actual_minutes-D.baseline_minutes_last
D['change_group']=np.where(D.minutes_change.eq(0),'unchanged','changed')
def stats(g):
 return dict(n=len(g),points_mae=float(abs(g.points_error).mean()),points_baseline_mae=float(abs(g.baseline_points-g.actual_points).mean()),points_bias=float(g.points_error.mean()),minutes_mae=float(abs(g.minutes_error).mean()),minutes_mean_baseline_mae=float(abs(g.baseline_minutes-g.actual_minutes).mean()),minutes_last_baseline_mae=float(abs(g.baseline_minutes_last-g.actual_minutes).mean()),minutes_rmse=float(np.sqrt((g.minutes_error**2).mean())),minutes_last_rmse=float(np.sqrt(((g.baseline_minutes_last-g.actual_minutes)**2).mean())),brier=float(brier_score_loss(g.actual_played,g.participation)))
for col in ['gameweek','position','history_group','actual_minutes_group','prior_minutes_group','change_group']:
 rows=[{col:str(k),**stats(g)} for k,g in D.groupby(col,observed=True)]
 pd.DataFrame(rows).to_csv(OUT/f'by_{col}.csv',index=False)
# Fixed probability bins; retain counts. Empty bins have no observed rate.
cal=[]
for name,col in [('model','participation'),('baseline','baseline_played')]:
 ix=np.minimum((D[col]*10).astype(int),9)
 for b in range(10):
  g=D[ix==b];cal.append(dict(method=name,bin=b,lower=b/10,upper=(b+1)/10,n=len(g),predicted=float(g[col].mean()) if len(g) else None,observed=float(g.actual_played.mean()) if len(g) else None))
C=pd.DataFrame(cal);C.to_csv(OUT/'calibration_bins.csv',index=False)
metrics={name:dict(brier=float(brier_score_loss(D.actual_played,D[col])),auc=float(roc_auc_score(D.actual_played,D[col])),ece_10_bins=float((g.n*abs(g.predicted-g.observed)).sum()/len(D))) for (name,col),(_,g) in zip([('baseline','baseline_played'),('model','participation')],C.groupby('method'))}
summary=dict(n=len(D),nonplayers=int(D.actual_minutes.eq(0).sum()),above90=int(D.actual_minutes.gt(90).sum()),metrics=metrics,overall=stats(D),changed={str(k):stats(g) for k,g in D.groupby('change_group')},probability_mean=float(D.participation.mean()),participation_rate=float(D.actual_played.mean()),within2=float(D.points_error.abs().le(2).mean()),source_sha256=hashlib.sha256((ROOT/'predictions.csv').read_bytes()).hexdigest())
for metric in ['points_error','minutes_error']:
 D.assign(absolute_error=D[metric].abs()).sort_values('absolute_error',ascending=False).head(30).to_csv(OUT/f'largest_{metric}.csv',index=False)
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'figure.dpi':130})
def save(name):plt.tight_layout();plt.savefig(OUT/name,dpi=170);plt.close()
g=D.groupby('gameweek');f=g.apply(lambda x:pd.Series(stats(x)),include_groups=False)
plt.figure(figsize=(9,4));plt.plot(f.index,f.points_mae,label='Model');plt.plot(f.index,f.points_baseline_mae,label='Five-round mean');plt.ylabel('Points MAE');plt.xlabel('Target gameweek');plt.title('Corrected historical experiment | overall points');plt.legend();save('01_points_mae.png')
plt.figure(figsize=(9,4));plt.plot(g.actual_points.mean(),label='Actual');plt.plot(g.overall_points.mean(),label='Predicted');plt.ylabel('Mean points');plt.xlabel('Target gameweek');plt.legend();save('02_mean_points.png')
plt.figure(figsize=(9,4));
for c,l in [('minutes_mae','Model'),('minutes_mean_baseline_mae','Five-round mean'),('minutes_last_baseline_mae','Previous round')]:plt.plot(f.index,f[c],label=l)
plt.ylabel('Minutes MAE');plt.xlabel('Target gameweek');plt.legend();save('03_minutes_mae.png')
fig,axs=plt.subplots(1,2,figsize=(10,4))
for name,c in C.groupby('method'):
 axs[0].plot(c.predicted,c.observed,'o-',label=name);axs[1].plot(c.bin/10+.05,c.n,'o-',label=name)
axs[0].plot([0,1],[0,1],'k--');axs[0].set(xlabel='Mean predicted probability',ylabel='Observed fraction >=30 minutes',title='Reliability: fixed 0.1-wide bins');axs[1].set(xlabel='Probability bin midpoint',ylabel='Number of observations',title='Bin support');axs[0].legend();save('04_calibration.png')
plt.figure(figsize=(7,5));plt.scatter(D.actual_points,D.overall_points,s=6,alpha=.12);lo=min(D.actual_points.min(),0);hi=max(D.actual_points.max(),D.overall_points.max());plt.plot([lo,hi],[lo,hi],'k--');plt.xlabel('Actual points');plt.ylabel('Predicted points');plt.title('GW21-35 | all eligible observations');save('05_scatter.png')
plt.figure(figsize=(9,4));plt.hist(D.points_error,bins=60);plt.axvline(0,color='black',ls='--');plt.xlabel('Predicted - actual points');plt.ylabel('Observations');save('06_error_distribution.png')
b=pd.read_csv(OUT/'by_position.csv');x=np.arange(len(b));plt.figure(figsize=(8,4));plt.bar(x-.18,b.points_mae,.36,label='Model');plt.bar(x+.18,b.points_baseline_mae,.36,label='Baseline');plt.xticks(x,[f'{r.position}\nn={r.n}' for r in b.itertuples()]);plt.ylabel('Points MAE');plt.title('Position labels provisional | historical provenance unverified');plt.legend();save('07_position.png')
plt.figure(figsize=(9,4));plt.bar(f.index,f.n);plt.xlabel('Target gameweek');plt.ylabel('Unique player-gameweek rows');plt.title('Corrected evaluation coverage');save('09_coverage.png')
plt.figure(figsize=(9,4));plt.plot([k for k,_ in g],[roc_auc_score(z.actual_played,z.participation) for _,z in g],label='Model');plt.plot([k for k,_ in g],[roc_auc_score(z.actual_played,z.baseline_played) for _,z in g],label='Baseline');plt.ylim(.5,1);plt.xlabel('Target gameweek');plt.ylabel('ROC-AUC (>=30 minutes)');plt.legend();save('10_auc.png')
(OUT/'summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False))
# Reconcile against Day 3; bins and grouping must account for every row.
s=json.loads((ROOT/'summary.json').read_text())
assert np.isclose(summary['overall']['points_mae'],s['comparisons']['overall_points']['pooled_model'])
assert np.isclose(metrics['model']['brier'],s['comparisons']['participation']['pooled_model'])
assert C.groupby('method').n.sum().eq(len(D)).all()
assert np.isclose(float((f.points_mae*f.n).sum()/f.n.sum()),summary['overall']['points_mae'])
print(json.dumps(summary,indent=2,allow_nan=False))

# Predetermined selection: best, median and worst points MAE gameweeks.
ordered=f.sort_values('points_mae').index.tolist()
selected=[int(ordered[0]),int(ordered[len(ordered)//2]),int(ordered[-1])]
fig,axes=plt.subplots(1,3,figsize=(13,4))
for ax,gw in zip(axes,selected):
 z=D[D.gameweek==gw]; ax.scatter(z.actual_points,z.overall_points,s=9,alpha=.25)
 ax.plot([0,25],[0,25],'k--');ax.set(xlabel='Actual points',ylabel='Predicted points',title=f'GW{gw}: MAE {abs(z.points_error).mean():.3f}; n={len(z)}')
save('11_selected_gameweeks.png')
assert all(np.isfinite(v) for q in metrics.values() for v in q.values())
(OUT/'analysis_metadata.json').write_text(json.dumps({'selected_gameweeks':selected,'selection':'best, median, worst pooled overall-points MAE','script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'position_join':'exact season/player/gameweek, one-to-one; historical metadata unverified'},indent=2))
