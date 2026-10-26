"""Retrospective season-leader cohort diagnostics; no model fitting or production writes."""
from pathlib import Path
import gzip, json, hashlib, re
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/'output/evaluation-enriched'
OUT=ROOT/'output/evaluation-top-players'
END_GW=35
COUNTS={'GK':5,'DEF':15,'MID':15,'FWD':10}
POS={1:'GK',2:'DEF',3:'MID',4:'FWD'}
BLUE='#2378b8';ORANGE='#d17b21';GRAY='#333333';GREEN='#388454'

def metrics(d):
 q=d[d.actual_minutes.ge(30)]
 def mae(a,b):return float((a-b).abs().mean()) if len(a) else None
 return {'n':len(d),'qualifying_n':len(q),'zero_points_n':int(d.actual_points.eq(0).sum()),'zero_minutes_n':int(d.actual_minutes.eq(0).sum()),
 'actual_total':float(d.actual_points.sum()),'predicted_total':float(d.overall_points.sum()),'baseline_total':float(d.baseline_points.sum()),
 'total_bias':float((d.overall_points-d.actual_points).sum()),'overall_mae':mae(d.overall_points,d.actual_points),'baseline_mae':mae(d.baseline_points,d.actual_points),
 'reduced_mae':mae(d.reduced_overall,d.actual_points),'zero_predictor_mae':float(d.actual_points.abs().mean()),
 'overall_rmse':float(np.sqrt(((d.overall_points-d.actual_points)**2).mean())),
 'overall_bias':float((d.overall_points-d.actual_points).mean()),'within2_pct':float((d.overall_points-d.actual_points).abs().le(2).mean()*100),
 'conditional_mae':mae(q.conditional_points,q.actual_points),'conditional_baseline_mae':mae(q.baseline_conditional,q.actual_points),
 'conditional_reduced_mae':mae(q.reduced_conditional,q.actual_points),'conditional_actual_total':float(q.actual_points.sum()),
 'conditional_predicted_total':float(q.conditional_points.sum()),'conditional_rmse':float(np.sqrt(((q.conditional_points-q.actual_points)**2).mean())) if len(q) else None}

def save(fig,path):
 fig.tight_layout();fig.savefig(path,dpi=175,bbox_inches='tight');plt.close(fig)

def main():
 OUT.mkdir(exist_ok=True);(OUT/'players').mkdir(exist_ok=True);(OUT/'positions').mkdir(exist_ok=True)
 raw=pd.read_parquet(SOURCE/'input_snapshot.parquet');raw=raw[raw.season.eq('2025-26')].copy()
 assert sorted(raw.gameweek.unique())==list(range(1,39))
 assert not raw.duplicated(['season','player_id','gameweek']).any()
 assert raw.total_points.notna().all()
 capture=ROOT/'output/historical-data-research/captures/GW36-2026-05-09T0000Z/bootstrap-static.json.gz'
 payload=json.loads(gzip.decompress(capture.read_bytes()));teams={t['id']:t['name'] for t in payload['teams']}
 meta=pd.DataFrame([{'player_id':e['id'],'name':e['web_name'],'full_name':e['first_name']+' '+e['second_name'],'position':POS[e['element_type']],'team':teams[e['team']],'player_code':e['code']} for e in payload['elements']])
 ranks=raw.groupby('player_id').agg(season_points=('total_points','sum'),season_rows=('gameweek','size')).reset_index().merge(meta,on='player_id',how='left',validate='one_to_one')
 # New very-late entrants absent at GW36 cannot outrank the selected cutoff unnoticed.
 selected=[]
 for pos,count in COUNTS.items():
  s=ranks[ranks.position.eq(pos)].sort_values(['season_points','player_id'],ascending=[False,True]).head(count).copy();assert len(s)==count
  s['position_rank']=range(1,count+1);selected.append(s)
 selected=pd.concat(selected,ignore_index=True)
 missing=ranks[ranks.position.isna()]
 assert len(missing)==0 or missing.season_points.max()<selected.groupby('position').season_points.min().min(),'Unmapped player may affect ranking'
 selected.to_csv(OUT/'selected_players.csv',index=False)
 full=pd.read_csv(SOURCE/'full_predictions.csv');red=pd.read_csv(SOURCE/'reduced_matched_predictions.csv')
 keys=['season','player_id','gameweek'];assert not full.duplicated(keys).any()
 full=full.merge(red[keys+['overall_points','conditional_points']].rename(columns={'overall_points':'reduced_overall','conditional_points':'reduced_conditional'}),on=keys,validate='one_to_one')
 d=full.merge(selected,on='player_id',how='inner',validate='many_to_one').sort_values(['position','position_rank','gameweek'])
 assert d.season.eq('2025-26').all() and d.gameweek.between(21,END_GW).all()
 assert set(d.player_id)==set(selected.player_id)
 labels=raw[['player_id','gameweek','total_points','minutes']].merge(d[['player_id','gameweek','actual_points','actual_minutes']],on=['player_id','gameweek'])
 assert np.allclose(labels.total_points,labels.actual_points) and np.allclose(labels.minutes,labels.actual_minutes)
 d['overall_error']=d.overall_points-d.actual_points;d['conditional_eligible']=d.actual_minutes.ge(30)
 d['conditional_error']=(d.conditional_points-d.actual_points).where(d.conditional_eligible)
 d.to_csv(OUT/'player_gameweek_results.csv',index=False)
 plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.grid':True,'grid.alpha':.2})
 player_results=[]
 for row in selected.to_dict('records'):
  z=d[d.player_id.eq(row['player_id'])].sort_values('gameweek');m={**row,**metrics(z)}
  missing_gw=sorted(set(range(21,END_GW+1))-set(z.gameweek));m['missing_gameweeks']=missing_gw
  slug=f"{row['position']}_{int(row['position_rank']):02d}_{int(row['player_id'])}"
  fig,axs=plt.subplots(3,1,figsize=(9,8.2),sharex=True)
  axs[0].plot(z.gameweek,z.actual_points,'o-',color=GRAY,label='Actual')
  axs[0].plot(z.gameweek,z.overall_points,'o-',color=BLUE,label='Risk-adjusted points')
  axs[0].plot(z.gameweek,z.baseline_points,'--',color=ORANGE,label='Five-round baseline');axs[0].set_ylabel('Risk-adjusted points');axs[0].legend(ncol=3,fontsize=9)
  q=z.actual_minutes.ge(30)
  axs[1].plot(z.gameweek,z.actual_points.where(q),'o-',color=GRAY,label='Actual: 30+ minutes')
  axs[1].plot(z.gameweek,z.conditional_points.where(q),'o-',color=BLUE,label='Conditional prediction')
  axs[1].plot(z.gameweek,z.baseline_conditional.where(q),'--',color=ORANGE,label='Conditional baseline');axs[1].set_ylabel('Conditional points');axs[1].legend(ncol=3,fontsize=8)
  for col,label,color,style in [('actual_points','Actual',GRAY,'-'),('overall_points','Risk-adjusted points',BLUE,'-'),('baseline_points','Five-round baseline',ORANGE,'--')]:axs[2].plot(z.gameweek,z[col].cumsum(),style,color=color,label=label)
  axs[2].set_ylabel('Cumulative points');axs[2].set_xlabel('Target gameweek');axs[2].set_xticks(range(21,END_GW+1));axs[2].legend(ncol=3,fontsize=9)
  fig.suptitle(f"{row['name']} | {row['position']} rank {row['position_rank']} | season points {row['season_points']:.0f}",fontsize=13)
  m['graph']=f'players/{slug}.png';save(fig,OUT/m['graph']);player_results.append(m)
 pd.DataFrame(player_results).to_csv(OUT/'per_player_metrics.csv',index=False)
 positions=[];weekly=[]
 for pos in COUNTS:
  z=d[d.position.eq(pos)];m={'position':pos,'players':COUNTS[pos],**metrics(z)};positions.append(m)
  f=pd.DataFrame([{'gameweek':gw,**metrics(g)} for gw,g in z.groupby('gameweek')]);f['position']=pos;weekly.append(f)
  fig,axs=plt.subplots(3,1,figsize=(9,8.2),sharex=True)
  for c,label,color in [('overall_mae','Production',BLUE),('baseline_mae','Baseline',ORANGE),('reduced_mae','Reduced',GREEN)]:axs[0].plot(f.gameweek,f[c],'o-',label=label,color=color)
  axs[0].set_ylabel('Risk-adjusted points MAE');axs[0].legend(ncol=3)
  for c,label,color in [('conditional_mae','Production',BLUE),('conditional_baseline_mae','Baseline',ORANGE),('conditional_reduced_mae','Reduced',GREEN)]:axs[1].plot(f.gameweek,f[c],'o-',label=label,color=color)
  axs[1].set_ylabel('Conditional MAE');axs[1].legend(ncol=3)
  for c,label,color in [('actual_total','Actual',GRAY),('predicted_total','Risk-adjusted points',BLUE),('baseline_total','Baseline',ORANGE)]:axs[2].plot(f.gameweek,f[c],'o-',label=label,color=color)
  axs[2].set_ylabel('Group total points');axs[2].set_xlabel('Target gameweek');axs[2].set_xticks(range(21,END_GW+1));axs[2].legend(ncol=3)
  fig.suptitle(f'{pos}: top {COUNTS[pos]} season scorers | GW21-{END_GW}',fontsize=13)
  save(fig,OUT/'positions'/f'{pos}_gameweeks.png')
  members=pd.DataFrame(player_results);members=members[members.position.eq(pos)].sort_values('position_rank');y=np.arange(len(members))
  fig,axs=plt.subplots(1,2,figsize=(11,max(4,len(members)*.43)))
  for ax,mc,bc,title in [(axs[0],'overall_mae','baseline_mae','Risk-adjusted points MAE'),(axs[1],'conditional_mae','conditional_baseline_mae','Conditional points MAE')]:
   ax.barh(y-.18,members[mc],.36,label='Production',color=BLUE);ax.barh(y+.18,members[bc],.36,label='Baseline',color=ORANGE);ax.set_yticks(y,members.name);ax.invert_yaxis();ax.set_title(title);ax.set_xlabel('Points');ax.legend()
  save(fig,OUT/'positions'/f'{pos}_players.png')
 pd.DataFrame(positions).to_csv(OUT/'per_position_metrics.csv',index=False);pd.concat(weekly).to_csv(OUT/'position_gameweek_metrics.csv',index=False)
 cohorts=[{'cohort':'All evaluated players',**metrics(full)},{'cohort':'Selected 45 players',**metrics(d)},{'cohort':'All: at least 30 minutes',**metrics(full[full.actual_minutes.ge(30)])}]
 pd.DataFrame(cohorts).to_csv(OUT/'cohort_comparison.csv',index=False)
 fig,axs=plt.subplots(1,2,figsize=(10,4));p=pd.DataFrame(positions);x=np.arange(4)
 for ax,mc,bc,title in [(axs[0],'overall_mae','baseline_mae','Risk-adjusted points MAE'),(axs[1],'conditional_mae','conditional_baseline_mae','Conditional points MAE')]:
  ax.bar(x-.18,p[mc],.36,label='Production',color=BLUE);ax.bar(x+.18,p[bc],.36,label='Baseline',color=ORANGE);ax.set_xticks(x,p.position);ax.set_title(title);ax.set_ylabel('Points');ax.legend()
 save(fig,OUT/'position_summary.png')
 result={'season':'2025-26','gameweeks':[21,END_GW],'selection':'Top final-season recorded points by GW36 archived position; points summed over GW1-38; ties resolved by ascending player ID. Retrospective outcome-selected cohort, not a prospective selection strategy.',
 'full_season_ranking_note':'Local recorded season totals. Previous validation corroborated cumulative outcomes through GW35; final three rounds are from the saved local dataset, not independently verified against a final official leaderboard in this analysis.',
 'prediction_note':'Saved walk-forward forecasts reused. Conditional metrics and graph lines use actual minutes >=30 only. Cumulative forecasts sum successive one-week forecasts, not one pre-GW21 multiweek forecast.',
 'players':player_results,'positions':positions,'cohorts':cohorts,'checks':{'selected_players':len(selected),'expected_counts':COUNTS,'matched_rows':len(d),'missing_selected_forecasts':int(45*(END_GW-20)-len(d)),'unmapped_season_players':len(missing),'labels_match':True,'unique_prediction_keys':True},
 'sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [SOURCE/'input_snapshot.parquet',SOURCE/'full_predictions.csv',capture]},
 'accuracy_source':'https://otexts.com/fpp3/accuracy.html'}
 (OUT/'results.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
 print(json.dumps({'checks':result['checks'],'cohorts':cohorts,'positions':positions},indent=2))

if __name__=='__main__':main()
