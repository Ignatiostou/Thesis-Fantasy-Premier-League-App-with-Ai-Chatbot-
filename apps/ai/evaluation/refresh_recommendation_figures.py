"""Show full controlled grids and recorded case distributions; no model fitting."""
from pathlib import Path
import json, shutil, hashlib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/evaluation-scoring-grid'
FIG=OUT/'figures';FIG.mkdir(exist_ok=True)
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
def save(fig,name):
    fig.tight_layout();fig.savefig(FIG/name,dpi=180);plt.close(fig)
r=json.loads((OUT/'results.json').read_text(encoding='utf-8'))
prob=np.arange(101)/100
scores=np.array([v['scores'] for v in r['risk']]).reshape(576,101,3)
assert np.isfinite(scores).all() and (np.diff(scores,axis=1)>=0).all()
fig,axes=plt.subplots(1,3,figsize=(12,4),sharex=True,sharey=True)
for j,(ax,label,color) in enumerate(zip(axes,['Cautious','Balanced','Aggressive'],['#2378b8','#da8a23','#42926c'])):
    ax.plot(prob,scores[:,:,j].T,color=color,alpha=.025,lw=.6)
    lo,hi=np.quantile(scores[:,:,j],[.1,.9],axis=0)
    ax.fill_between(prob,lo,hi,color=color,alpha=.18,label='10th–90th percentile')
    ax.plot(prob,np.median(scores[:,:,j],axis=0),color=color,lw=2,label='Median')
    ax.set(title=label,xlabel='Participation probability');ax.set_xlim(0,1)
axes[0].set_ylabel('Ranking score');axes[2].legend(fontsize=8)
fig.suptitle('576 synthetic input settings per profile — all curves shown',fontsize=12)
save(fig,'01_risk_sensitivity.png')
score={h['planningHorizon']:{p['id']:p['score'] for p in h['ranked']} for h in r['horizons']}
rank={h['planningHorizon']:{p['id']:p['rank'] for p in h['ranked']} for h in r['horizons']}
ids=list(range(1,65));pairs=[]
for i in ids:
    for j in ids:
        if j>i:pairs.append((score[1][i]-score[1][j],score[3][i]-score[3][j]))
pairs=np.array(pairs);reverse=int((pairs[:,0]*pairs[:,1]<0).sum());ties=int(((pairs[:,0]==0)|(pairs[:,1]==0)).sum())
fig,axes=plt.subplots(1,2,figsize=(11,4.8))
for i in ids:axes[0].plot([1,2,3],[rank[h][i] for h in [1,2,3]],alpha=.25,lw=.9,color='#2378b8')
axes[0].set(xticks=[1,2,3],xticklabels=['Short','Balanced','Long'],ylabel='Rank among 64 trajectories',title='Every trajectory across planning settings');axes[0].invert_yaxis()
axes[1].scatter(pairs[:,0],pairs[:,1],s=12,alpha=.25,c=np.where(pairs[:,0]*pairs[:,1]<0,'#c36329','#2378b8'))
axes[1].axhline(0,color='grey',ls='--');axes[1].axvline(0,color='grey',ls='--')
axes[1].set(xlabel='Score A minus B: short horizon',ylabel='Score A minus B: long horizon',title=f'{reverse:,} strict reversals / {len(pairs):,} pairs')
save(fig,'02_horizon_rank_change.png')
summary={'risk_settings':576,'probabilities':101,'risk_profiles':3,'risk_scores':int(scores.size),'horizon_trajectories':64,'pairwise_comparisons':len(pairs),'strict_reversals':reverse,'pairs_with_endpoint_tie':ties,'rank_changes':sum(rank[1][i]!=rank[3][i] for i in ids),'top10_overlap':len(set(r['horizons'][0]['ranked'][i]['id'] for i in range(10))&set(r['horizons'][2]['ranked'][i]['id'] for i in range(10)))}

week=pd.read_csv(ROOT/'output/evaluation-day6/weekly_results.csv')
fig,axes=plt.subplots(1,2,figsize=(11,4))
for ax,task,title in zip(axes,['ranking_top10','captain'],['Top-10 ranking','Captain selection (before doubling)']):
    for policy,label in [('balanced' if task=='ranking_top10' else 'production','Application'),('xpts','Risk-adjusted points'),('form','Recent form')]:
        z=week[(week.task==task)&(week.policy==policy)].sort_values('gameweek');assert len(z)==15
        ax.plot(z.gameweek,z.value,'o-',markersize=3,label=f'{label} (mean {z.value.mean():.3f})')
    ax.set(xlabel='Gameweek',ylabel='Mean actual points',title=title);ax.legend(fontsize=8)
save(fig,'03_selection_returns.png')
cases=pd.read_csv(ROOT/'output/evaluation-day6/case_results.csv')
fig,axes=plt.subplots(1,2,figsize=(11,4))
for ax,task,title in zip(axes,['transfer_cost0','transfer_cost4'],['No transfer penalty','Four-point penalty']):
    for j,policy in enumerate(['production','xpts']):
        z=cases[(cases.task==task)&(cases.policy==policy)].sort_values(['gameweek','case']);assert len(z)==300
        # A fixed symmetric offset shows overlapping cases without stochastic jitter.
        offset=((np.arange(len(z))%20)-9.5)/90
        ax.scatter(j+offset,z.value,s=9,alpha=.18,color=['#2378b8','#da8a23'][j])
        ax.plot([j-.25,j+.25],[z.value.mean()]*2,color='black',lw=2)
    ax.set(xticks=[0,1],xticklabels=['Application','Risk-adjusted points'],ylabel='Actual net gain',title=title+' — 300 cases per policy');ax.axhline(0,color='grey',lw=.6)
save(fig,'04_transfer_returns.png')
returns=pd.read_csv(ROOT/'output/evaluation-day8/returns.csv')
fig,axes=plt.subplots(1,3,figsize=(12,4))
for ax,h in zip(axes,[1,3,5]):
    z=returns[returns.horizon==h].pivot(index='gameweek',columns='policy',values='actual_points')
    columns=['personalised','xpts','form'];assert len(z)==11
    for _,row in z.iterrows():ax.plot(range(3),row[columns],'o-',color='#2378b8',alpha=.25,markersize=3)
    ax.plot(range(3),z[columns].mean(),'D-',color='black',label='Mean',lw=2)
    ax.set(xticks=range(3),xticklabels=['Personalised','Risk-adjusted','Form'],ylabel='Actual XI points incl. captain',title=f'{h} gameweek(s) — 11 starts');ax.tick_params(axis='x',rotation=20);ax.legend(fontsize=8)
save(fig,'06_squad_returns.png')
totals=pd.read_csv(ROOT/'output/evaluation-day9/case_totals.csv')
policies=['app_short','app_balanced','app_long','xpts_global','form_global','hold']
labels=['Short','Balanced','Long','Risk-adjusted','Form','No transfers']
fig,ax=plt.subplots(figsize=(10,4.5))
pivot=totals.pivot(index='case',columns='policy',values='points')[policies];assert pivot.shape==(20,6)
for _,row in pivot.iterrows():ax.plot(range(6),row,'o-',color='#2378b8',alpha=.25,markersize=3)
ax.plot(range(6),pivot.mean(),'D-',color='black',lw=2,label='Mean over 20 initial squads')
ax.set(xticks=range(6),xticklabels=labels,ylabel='Net points over GW21–38',title='All 20 paired synthetic starting squads');ax.legend();save(fig,'08_policy_totals.png')
scored=pd.DataFrame(json.loads((ROOT/'output/evaluation-day9/scored.json').read_text()))
fig,axes=plt.subplots(2,3,figsize=(12,7),sharex=True,sharey=True)
for ax,policy,label in zip(axes.flat,policies,labels):
    z=scored[scored.policy==policy].pivot(index='gameweek',columns='case',values='points').sort_index().cumsum();assert z.shape==(18,20)
    ax.plot(z.index,z,color='#2378b8',alpha=.2,lw=.8);ax.plot(z.index,z.mean(axis=1),color='black',lw=2,label='Mean');ax.set(title=label,xlabel='Gameweek',ylabel='Cumulative net points')
axes[0,0].legend(fontsize=8);fig.suptitle('20 paths per policy; shared outcomes, not independent trials');save(fig,'09_cumulative_returns.png')
fig,axes=plt.subplots(1,2,figsize=(11,4),sharey=True)
for ax,col,label in zip(axes,['bbIncrement','tcIncrement'],['Bench Boost','Triple Captain']):
    z=scored[scored.policy=='app_balanced'].pivot(index='gameweek',columns='case',values=col).sort_index();assert z.shape==(18,20)
    ax.plot(z.index,z,color='#2378b8',alpha=.22,lw=.8);ax.plot(z.index,z.mean(axis=1),color='black',lw=2,label='Mean')
    ax.set(xlabel='Gameweek',ylabel='Extra points in this round',title=label+' — all 20 squads');ax.legend(fontsize=8)
fig.suptitle('Independent one-round counterfactuals, not a chip schedule');save(fig,'10_chip_opportunities.png')
(OUT/'summary.json').write_text(json.dumps(summary,indent=2))
sources=[ROOT/'output/evaluation-day6/weekly_results.csv',ROOT/'output/evaluation-day6/case_results.csv',ROOT/'output/evaluation-day8/returns.csv',ROOT/'output/evaluation-day9/case_totals.csv',ROOT/'output/evaluation-day9/scored.json']
(OUT/'historical-source-hashes.json').write_text(json.dumps({str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},indent=2))
print(json.dumps(summary,indent=2))
