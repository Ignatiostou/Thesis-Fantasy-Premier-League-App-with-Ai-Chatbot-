"""Paired circular-block bootstrap of equal-gameweek mean loss differences."""
from pathlib import Path
import json
import numpy as np
import pandas as pd
ROOT=Path('output/evaluation-day3/gw21-35');OUT=Path('output/evaluation-ml-statistics');OUT.mkdir(exist_ok=True)
def interval(x,length=3,family=1):
 x=np.asarray(x,float);assert x.ndim==1 and len(x)>=10 and np.isfinite(x).all()
 rng=np.random.default_rng(20260915)
 starts=rng.integers(0,len(x),size=(100000,int(np.ceil(len(x)/length))))
 indices=((starts[:,:,None]+np.arange(length))%len(x)).reshape(100000,-1)[:,:len(x)]
 samples=x[indices].mean(axis=1)
 lo,hi=np.quantile(samples,[.025,.975]);a,b=np.quantile(samples,[.025/family,1-.025/family])
 leave_one_out=[np.delete(x,i).mean() for i in range(len(x))]
 return {'mean_difference':float(x.mean()),'ci95_low':float(lo),'ci95_high':float(hi),'family_low':float(a),'family_high':float(b),'negative_weeks':int((x<0).sum()),'loo_min':float(min(leave_one_out)),'loo_max':float(max(leave_one_out))}
def loss(d,task):
 if task=='conditional_points':d=d[d.actual_played==1]
 target='actual_played' if task=='participation' else 'actual_minutes' if task=='minutes' else 'actual_points'
 err=d[task]-d[target];return pd.Series((err**2 if task=='participation' else abs(err)).to_numpy(),index=d.gameweek).groupby(level=0).mean().sort_index().to_numpy()
def main():
 # Sanity checks: constant differences have degenerate intervals; signs reverse.
 t=interval(np.ones(15));assert t['ci95_low']==t['ci95_high']==1
 x=np.linspace(-1,2,15);a=interval(x);b=interval(-x);assert np.isclose(a['ci95_low'],-b['ci95_high'])
 d=pd.read_csv(ROOT/'predictions.csv');rows=[]
 specs=[('conditional_points','baseline_conditional'),('overall_points','baseline_points'),('participation','baseline_played'),('minutes','baseline_minutes'),('minutes','baseline_minutes_last')]
 for task,base in specs:
  z=d.copy();z[task]=z[base];delta=loss(d,task)-loss(z,task)
  for length in [2,3,5]:rows.append({'task':task,'baseline':base,'block_length':length,**interval(delta,length,5)})
 pd.DataFrame(rows).to_csv(OUT/'baseline_uncertainty.csv',index=False)
 (OUT/'protocol.json').write_text(json.dumps({'estimand':'equal-gameweek mean paired model loss minus comparator loss','resamples':100000,'seed':20260915,'primary_block_length':3,'sensitivity_block_lengths':[2,5],'resampling':'circular contiguous gameweek blocks, concatenated and truncated to 15 weeks; wrap-around is a modelling assumption','baseline_family':5,'intervals':'percentile 95% and Bonferroni family-wise nominal 95% (99% marginal for 5 comparisons)','limitations':['15 gameweeks only; bootstrap coverage approximate','Requires approximate stability and short-range temporal dependence; expanding training and special gameweeks can violate these','No refitting inside bootstrap; conditional on fitted predictions and this historical corpus','No independent-player assumption; no claim of untouched holdout','No p-values or new hyperparameter selection']},indent=2))
 comp=Path('output/evaluation-ml-components')
 if all((comp/f'{n}_predictions.csv').exists() for n in ['full','recent_points','recent_minutes','ict','season_history']):
  full=pd.read_csv(comp/'full_predictions.csv');ar=[];fold=[]
  for name in ['recent_points','recent_minutes','ict','season_history']:
   ab=pd.read_csv(comp/f'{name}_predictions.csv')
   assert ab[['season','player_id','gameweek']].equals(full[['season','player_id','gameweek']])
   for task in ['conditional_points','overall_points','participation','minutes']:
    a=loss(ab,task);b=loss(full,task);delta=a-b
    for length in [2,3,5]:ar.append({'removed_group':name,'task':task,'full_loss':float(b.mean()),'ablated_loss':float(a.mean()),'block_length':length,**interval(delta,length,16)})
    fold.extend({'removed_group':name,'task':task,'gameweek':i+21,'difference':float(v)} for i,v in enumerate(delta))
  pd.DataFrame(ar).to_csv(comp/'ablation_uncertainty.csv',index=False);pd.DataFrame(fold).to_csv(comp/'fold_differences.csv',index=False)
 print(pd.DataFrame(rows).query('block_length==3').to_string(index=False))
if __name__=='__main__':main()
