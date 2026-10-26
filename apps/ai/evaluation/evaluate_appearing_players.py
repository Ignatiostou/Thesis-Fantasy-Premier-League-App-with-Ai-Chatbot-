"""Outcome-stratified diagnostics of saved forecasts; no fitting or API calls."""
import json, hashlib
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import roc_auc_score
from ml_uncertainty import interval

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output/evaluation-playing-players'
KEYS = ['season', 'player_id', 'gameweek']
GROUPS = ['recent_points','recent_minutes','ict','season_history','market','availability','api_form','position','team_strength']
TASKS = {'overall_points':('actual_points','baseline_points','Risk-adjusted points'),
         'conditional_points':('actual_points','baseline_conditional','Conditional points (30+ minutes)'),
         'minutes':('actual_minutes','baseline_minutes','Minutes'),
         'participation':('actual_played','baseline_played','Participation (30+ minutes)')}
POS = {1:'GK',2:'DEF',3:'MID',4:'FWD'}

def subset(d, task):
    return d[d.actual_minutes.ge(30)] if task == 'conditional_points' else d

def losses(d, task, col=None):
    s = subset(d, task)
    e = s[col or task] - s[TASKS[task][0]]
    return e.pow(2) if task == 'participation' else e.abs()

def metric(d):
    r = dict(n=len(d), players=d.player_id.nunique(), short_appearances=int((d.actual_minutes.gt(0)&d.actual_minutes.lt(30)).sum()),
             zero_points=int(d.actual_points.eq(0).sum()), negative_points=int(d.actual_points.lt(0).sum()),
             actual_total=d.actual_points.sum(), predicted_total=d.overall_points.sum(), baseline_total=d.baseline_points.sum())
    for task,(target,base,label) in TASKS.items():
        s = subset(d, task)
        for col, suffix in [(task,''),(base,'_baseline')]:
            r[task+suffix] = losses(d,task,col).mean()
        r[task+'_n'] = len(s)
        r[task+'_bias'] = (s[task]-s[target]).mean()
        r[task+'_rmse'] = np.sqrt(((s[task]-s[target])**2).mean())
    r['previous_minutes_baseline'] = (d.baseline_minutes_last-d.actual_minutes).abs().mean()
    r['conditional_on_all_appearances_mae'] = (d.conditional_points-d.actual_points).abs().mean()
    r['within2_pct'] = 100*(d.overall_points-d.actual_points).abs().le(2).mean()
    r['auc'] = roc_auc_score(d.actual_played,d.participation) if d.actual_played.nunique()==2 else np.nan
    return r

def save(fig, path):
    fig.tight_layout(); fig.savefig(path,dpi=130); plt.close(fig)

def table(d, cols):
    labels={'overall_points':'Risk-adjusted MAE','overall_points_baseline':'Points baseline MAE','conditional_points':'Conditional MAE (30+ min)',
      'conditional_points_baseline':'Conditional baseline MAE','conditional_on_all_appearances_mae':'Conditional forecast MAE on cohort (diagnostic)',
      'minutes':'Minutes MAE','minutes_baseline':'Five-round minutes MAE','previous_minutes_baseline':'Previous-round minutes MAE',
      'family_low':'Adjusted lower bound','family_high':'Adjusted upper bound','mean_difference':'Mean loss difference','n':'Rows'}
    def fmt(x): return f'{x:.4f}' if isinstance(x,(float,np.floating)) else labels.get(str(x),str(x))
    return '\n'.join(['| '+' | '.join(labels.get(c,c.replace('_',' ').capitalize()) for c in cols)+' |','| '+' | '.join(['---']*len(cols))+' |']+['| '+' | '.join(fmt(r[c]) for c in cols)+' |' for _,r in d.iterrows()])

def run(source, name):
    dest=OUT/name; dest.mkdir(parents=True,exist_ok=True)
    (dest/'players').mkdir(exist_ok=True); (dest/'positions').mkdir(exist_ok=True)
    original=pd.read_csv(source/'full_predictions.csv').sort_values(KEYS).reset_index(drop=True)
    frames={'Enriched': original}
    files={'Enriched':source/'full_predictions.csv'}
    for config in ['Reduced']+GROUPS:
        stem='reduced_matched' if config=='Reduced' and name=='2025-26' else 'reduced' if config=='Reduced' else 'without_'+config
        file=source/(stem+'_predictions.csv')
        if not file.exists():file=source/(stem+'_predictions.parquet')
        f=(pd.read_csv(file) if file.suffix=='.csv' else pd.read_parquet(file)).sort_values(KEYS).reset_index(drop=True)
        assert f[KEYS].equals(original[KEYS])
        np.testing.assert_allclose(f[['actual_points','actual_minutes','actual_played']],original[['actual_points','actual_minutes','actual_played']])
        frames[config]=f; files[config]=file
    mask=original.actual_minutes.gt(0)
    frames={k:v.loc[mask].copy().reset_index(drop=True) for k,v in frames.items()}
    d=frames['Enriched']
    if 'snapshot_position' not in d:
        meta=pd.read_parquet(source/'prepared.parquet')[KEYS+['snapshot_position','snapshot_name']]
        d=d.merge(meta,on=KEYS,validate='one_to_one')
    d['position']=d.snapshot_position.map(POS)
    assert d.position.notna().all() and not d.duplicated(KEYS).any()
    assert d.actual_minutes.gt(0).all()
    assert d.actual_played.eq(d.actual_minutes.ge(30).astype(float)).all()
    d.to_csv(dest/'selected_predictions.csv',index=False)
    cohorts=pd.DataFrame([{'cohort':'All eligible rows',**metric(original)}, {'cohort':'Minutes > 0',**metric(d)},
       {'cohort':'Minutes 1–29',**metric(d[d.actual_minutes.lt(30)])}, {'cohort':'Minutes >= 30',**metric(d[d.actual_minutes.ge(30)])}])
    cohorts.to_csv(dest/'cohort_comparison.csv',index=False)
    summaries=pd.DataFrame([{'configuration':k,**metric(v)} for k,v in frames.items()]); summaries.to_csv(dest/'configuration_metrics.csv',index=False)
    weekly=pd.DataFrame([{'gameweek':gw,**metric(z)} for gw,z in d.groupby('gameweek')]);weekly.to_csv(dest/'weekly_metrics.csv',index=False)
    position=pd.DataFrame([{'position':p,**metric(z)} for p,z in d.groupby('position')]);position.to_csv(dest/'position_metrics.csv',index=False)
    players=pd.DataFrame([{'player_id':pid,'name':z.snapshot_name.iloc[-1],'position':z.position.iloc[-1],**metric(z)} for pid,z in d.groupby('player_id')]);players.to_csv(dest/'player_metrics.csv',index=False)
    listing=players.sort_values(['position','name']).copy()
    listing['name']=listing.apply(lambda r:f'[{r["name"]}](players/{r.player_id}.png)',axis=1)
    (dest/'Player-index.md').write_text('# All appearing players\n\nOpen a player name to view the individual graph. Rows count appearances, not all gameweeks.\n\n'+table(listing,['name','position','n','overall_points','overall_points_baseline','conditional_points','conditional_points_baseline']),encoding='utf-8')
    pd.DataFrame([{'position':p,'gameweek':gw,**metric(z)} for (p,gw),z in d.groupby(['position','gameweek'])]).to_csv(dest/'position_weekly_metrics.csv',index=False)
    # The same selected keys are used for every comparator and removal experiment.
    comparisons=[]; deltas=[]
    specs=[(t,b) for t,(_,b,_) in TASKS.items()]+[('minutes','baseline_minutes_last')]+[(t,'Reduced') for t in TASKS]
    for task,comp in specs+[(t,g) for g in GROUPS for t in TASKS]:
        full_loss=losses(d,task).groupby(subset(d,task).gameweek).mean()
        if comp in frames:
            f=frames[comp];other=losses(f,task).groupby(subset(f,task).gameweek).mean()
        else:other=losses(d,task,comp).groupby(subset(d,task).gameweek).mean()
        delta=other-full_loss if comp in GROUPS else full_loss-other
        for gw,value in delta.items():deltas.append(dict(task=task,comparator=comp,gameweek=gw,difference=value))
        if len(delta)>=10:
            for length in [2,3,5]: comparisons.append(dict(task=task,comparator=comp,block_length=length,**interval(delta.to_numpy(),length,36 if comp in GROUPS else 9)))
        else: comparisons.append(dict(task=task,comparator=comp,block_length=0,mean_difference=delta.mean()))
    U=pd.DataFrame(comparisons);U.to_csv(dest/'uncertainty.csv',index=False)
    pd.DataFrame(deltas).to_csv(dest/'paired_gameweek_differences.csv',index=False)
    # Four task-specific weekly plots, with appropriate conditional subset.
    for number,task in enumerate(TASKS,1):
        fig,ax=plt.subplots(figsize=(9,4))
        for label,f,col in [('Enriched',d,task),('Reduced',frames['Reduced'],task),('Baseline',d,TASKS[task][1])]:
            s=subset(f,task);v=losses(f,task,col).groupby(s.gameweek).mean();ax.plot(v.index,v,'o-',label=label)
        if task=='minutes':
            v=losses(d,task,'baseline_minutes_last').groupby(d.gameweek).mean();ax.plot(v.index,v,'o-',label='Previous-round baseline')
        ax.set(xlabel='Gameweek',ylabel='Brier score' if task=='participation' else 'MAE',title=TASKS[task][2]+' — appearances only');ax.legend();save(fig,dest/f'{number:02d}_{task}.png')
    fig,ax=plt.subplots(figsize=(9,4))
    for col,label in [('actual_points','Actual'),('overall_points','Risk-adjusted'),('conditional_points','Conditional — descriptive on all appearances')]:
        v=d.groupby('gameweek')[col].mean();ax.plot(v.index,v,'o-',label=label)
    ax.set(xlabel='Gameweek',ylabel='Mean points');ax.legend(fontsize=8);save(fig,dest/'05_mean_points.png')
    fig,axes=plt.subplots(1,2,figsize=(11,4))
    for ax,task in zip(axes,['overall_points','conditional_points']):
        z=subset(d,task);ax.scatter(z.actual_points,z[task],s=9,alpha=.12)
        limits=[min(z.actual_points.min(),z[task].min()),max(z.actual_points.max(),z[task].max())];ax.plot(limits,limits,'k--');ax.set(xlabel='Actual points',ylabel='Predicted points',title=TASKS[task][2])
    save(fig,dest/'06_scatter.png')
    fig,ax=plt.subplots(figsize=(9,4));ax.hist(d.overall_points-d.actual_points,bins=50);ax.axvline(0,color='k',ls='--');ax.set(xlabel='Risk-adjusted prediction minus actual points',ylabel='Appearances');save(fig,dest/'07_errors.png')
    fig,axes=plt.subplots(1,2,figsize=(10,4))
    for ax,task in zip(axes,['overall_points','conditional_points']):
        x=np.arange(len(position));ax.bar(x-.18,position[task],.36,label='Enriched');ax.bar(x+.18,position[task+'_baseline'],.36,label='Baseline');ax.set_xticks(x,position.position);ax.set_title(TASKS[task][2]);ax.set_ylabel('MAE');ax.legend()
    save(fig,dest/'08_positions.png')
    bins=[]
    for label,f,col in [('Enriched',d,'participation'),('Reduced',frames['Reduced'],'participation'),('Baseline',d,'baseline_played')]:
        b=np.minimum((f[col]*10).astype(int),9)
        for i in range(10):
            z=f[b.eq(i)];bins.append(dict(model=label,bin=i,n=len(z),predicted=z[col].mean(),observed=z.actual_played.mean()))
    C=pd.DataFrame(bins);C.to_csv(dest/'calibration_bins.csv',index=False)
    fig,axes=plt.subplots(1,2,figsize=(10,4))
    for label,z in C.groupby('model'):
        z=z[z.n.gt(0)];axes[0].plot(z.predicted,z.observed,'o-',label=label);axes[1].plot((z.bin+.5)/10,z.n,'o-',label=label)
    axes[0].plot([0,1],[0,1],'k--');axes[0].set(xlabel='Predicted P(30+ minutes)',ylabel='Observed rate among appearances');axes[1].set(xlabel='Probability bin',ylabel='Appearances');axes[0].legend();save(fig,dest/'09_calibration.png')
    fig,ax=plt.subplots(figsize=(9,4));ax.bar(weekly.gameweek,weekly.n,label='All appearances');ax.bar(weekly.gameweek,weekly.short_appearances,label='1–29 minutes');ax.set(xlabel='Gameweek',ylabel='Player-gameweeks');ax.legend();save(fig,dest/'10_coverage.png')
    fig,ax=plt.subplots(figsize=(9,4))
    for label,f,col in [('Enriched',d,'participation'),('Reduced',frames['Reduced'],'participation'),('Baseline',d,'baseline_played')]:
        v=f.groupby('gameweek').apply(lambda z:roc_auc_score(z.actual_played,z[col]) if z.actual_played.nunique()==2 else np.nan,include_groups=False);ax.plot(v.index,v,'o-',label=label)
    ax.set(xlabel='Gameweek',ylabel='ROC-AUC: 30+ versus 1–29 minutes',ylim=(0,1));ax.legend();save(fig,dest/'11_auc.png')
    fig,axes=plt.subplots(2,2,figsize=(11,8))
    for ax,task in zip(axes.flat,TASKS):
        z=U[U.task.eq(task)&U.comparator.isin(GROUPS)&U.block_length.eq(3 if len(weekly)>=10 else 0)]
        for i,r in enumerate(z.itertuples()):
            if hasattr(r,'family_low'):ax.plot([r.family_low,r.family_high],[i,i],color='steelblue')
            ax.plot(r.mean_difference,i,'o',color='steelblue')
        ax.set_yticks(range(len(z)),z.comparator);ax.axvline(0,color='grey',ls='--');ax.set_title(TASKS[task][2]);ax.set_xlabel('Removed-group loss minus full loss')
    fig.suptitle('Ablations: adjusted 95% intervals' if len(weekly)>=10 else 'Ablations: descriptive means, four rounds');save(fig,dest/'12_ablations.png')
    fig,axes=plt.subplots(2,2,figsize=(11,8))
    for ax,task in zip(axes.flat,TASKS):
        z=U[U.task.eq(task)&~U.comparator.isin(GROUPS)&U.block_length.eq(3 if len(weekly)>=10 else 0)]
        for i,r in enumerate(z.itertuples()):
            if hasattr(r,'family_low'):ax.plot([r.family_low,r.family_high],[i,i],color='steelblue')
            ax.plot(r.mean_difference,i,'o',color='steelblue')
        ax.set_yticks(range(len(z)),z.comparator);ax.axvline(0,color='grey',ls='--');ax.set_title(TASKS[task][2]);ax.set_xlabel('Enriched loss minus comparator loss')
    save(fig,dest/'13_comparisons.png')
    fig,axes=plt.subplots(1,2,figsize=(11,4))
    for ax,task in zip(axes,['overall_points','conditional_points']):
        z=subset(d,task)
        for col,label in [('actual_points','Actual'),(task,'Enriched'),(TASKS[task][1],'Baseline')]:
            v=z.groupby('gameweek')[col].sum().cumsum();ax.plot(v.index,v,'o-',label=label)
        ax.set(xlabel='Gameweek',ylabel='Cumulative points on selected rows',title=TASKS[task][2]);ax.legend()
    save(fig,dest/'14_cumulative_points.png')
    # Each player graph shows only that player's observed appearances. Missing weeks stay gaps.
    for pid,z in d.groupby('player_id'):
        if (dest/'players'/f'{pid}.png').exists():continue
        fig,axes=plt.subplots(2,1,figsize=(8,5),sharex=True)
        z=z.set_index('gameweek').reindex(sorted(original.gameweek.unique()))
        for ax,task in zip(axes,['overall_points','conditional_points']):
            use=z.actual_minutes.ge(30) if task=='conditional_points' else z.actual_minutes.gt(0)
            for col,label in [('actual_points','Actual'),(task,'Prediction'),(TASKS[task][1],'Baseline')]:ax.plot(z.index,z[col].where(use),'o-',label=label,markersize=3)
            ax.set_ylabel('Points');ax.set_title(TASKS[task][2],fontsize=10);ax.legend(fontsize=7)
        axes[1].set_xlabel('Gameweek');fig.suptitle(f'{z.snapshot_name.dropna().iloc[-1]} — player {pid}');save(fig,dest/'players'/f'{pid}.png')
    for pos,z in d.groupby('position'):
        fig,axes=plt.subplots(2,1,figsize=(9,6),sharex=True)
        for ax,task in zip(axes,['overall_points','conditional_points']):
            for col,label in [(task,'Enriched'),(TASKS[task][1],'Baseline')]:
                s=subset(z,task);v=losses(z,task,col).groupby(s.gameweek).mean();ax.plot(v.index,v,'o-',label=label)
            ax.set_ylabel('MAE');ax.set_title(TASKS[task][2]);ax.legend()
        axes[1].set_xlabel('Gameweek');fig.suptitle(pos+' — all observed appearances');save(fig,dest/'positions'/f'{pos}.png')
    m=metric(d);allm=metric(original)
    report=f'''# All appearing players — {name}

We selected every evaluated player-gameweek with actual minutes greater than zero, covering **GW{d.gameweek.min()}–{d.gameweek.max()}**. No top-player ranking or points threshold was used. The cohort has **{len(d):,} appearances from {d.player_id.nunique()} players**, compared with {len(original):,} rows before filtering. We excluded {len(original)-len(d):,} zero-minute rows, while retaining **{m['zero_points']} zero-point appearances and {m['negative_points']} negative-point appearances**. There are {m['short_appearances']} appearances of 1–29 minutes and {m['conditional_points_n']} of at least 30 minutes.

## Method

We reused the saved predictions from the original evaluation, without retraining, tuning or changing any forecast. All eleven configurations use identical selected rows. Selection uses the observed outcome, so this is a retrospective error diagnostic, not a deployable rule for predicting who will play. It supplements the all-player evaluation rather than replacing it.

Risk-adjusted points are the conditional forecast multiplied by P(30+ minutes). Conditional points MAE retains the original target population of actual 30+ minute appearances. The table also includes conditional forecasts scored on all appearances as a separately labelled diagnostic: that extends beyond the conditional model's target and should not be mistaken for its primary metric.

## Results

'''+table(cohorts,['cohort','n','overall_points','overall_points_baseline','conditional_points','conditional_points_baseline','conditional_on_all_appearances_mae','minutes','minutes_baseline','previous_minutes_baseline'])+f'''

For all appearing players, risk-adjusted points MAE is **{m['overall_points']:.3f}**, versus **{m['overall_points_baseline']:.3f}** for the baseline. Before filtering, it was {allm['overall_points']:.3f}. The change shows how strongly the evaluated population affects the headline error. Conditional points MAE is **{m['conditional_points']:.3f}**, versus **{m['conditional_points_baseline']:.3f}**. It is unchanged by removing zero-minute rows because its original calculation already used only 30+ minute appearances.

The risk-adjusted forecasts sum to **{m['predicted_total']:.1f} points**, compared with **{m['actual_total']:.0f} actual points** on these appearances; mean error is **{m['overall_points_bias']:.3f} points**. These totals sum one-week predictions on selected appearance rows, not a prospective team return. Conditioning on actual participation can produce underprediction because the forecasts still account for the possibility of not playing. It would therefore be inappropriate to remove that probability adjustment solely because of these selected-cohort results. **{m['within2_pct']:.1f}%** of risk-adjusted predictions lie within two points of the actual score.

## Position breakdown

'''+table(position,['position','n','overall_points','overall_points_baseline','conditional_points','conditional_points_baseline'])+'''

## Interpretation of participation and statistical analysis

Participation still means 30+ minutes. Within this cohort, ROC-AUC distinguishes 30+ minute appearances from 1–29 minute appearances; it no longer measures discrimination between players who appear and those who do not. Calibration is also conditional on appearing, whereas the original probabilities are unconditional. The calibration graph is a diagnostic of the selected group, not a replacement for full-population calibration.

For the 18-round season experiment, uncertainty is calculated from paired gameweek-average losses using 100,000 circular block-bootstrap samples, seed 20260915, primary block length 3 and sensitivities 2 and 5. Families contain nine comparator tests and 36 ablation tests. Plots use Bonferroni-adjusted 95% intervals; CSV files also retain marginal intervals. These are approximate retrospective intervals conditional on fitted predictions, not independent-player tests. For the four-round cross-season experiment, only descriptive paired differences are shown; no bootstrap confidence claim is made.

All nine feature-group removals are evaluated again on this cohort. Positive removal differences indicate worse performance without that group. A small or uncertain difference is not proof that a feature has no value: correlated groups may substitute for it. No retraining-based ablation was newly performed; we rescored the previously trained ablation predictions. Permutation importance was not recomputed or inferred from these removals.

## Figures

'''
    for p in sorted(dest.glob('*.png')):report+=f'\n![{p.stem}]({p.name})\n'
    report+='\nIndividual player graphs are in `players/`; four position time-series graphs are in `positions/`. Gaps mean no appearance in that round (or fewer than 30 minutes in the conditional panel), not missing predictions. Per-player metrics can be based on few appearances and should not be interpreted as stable player-specific accuracy.\n'
    report+='\n## What the figures show\n\n'
    report+=f"The risk-adjusted error plot compares the same appearance rows in each round. The enriched model beats the points baseline in {sum(losses(d,'overall_points').groupby(d.gameweek).mean() < losses(d,'overall_points','baseline_points').groupby(d.gameweek).mean())}/{len(weekly)} rounds. Its pooled MAE reduction is {100*(1-m['overall_points']/m['overall_points_baseline']):.1f}%. The mean-points plot and residual distribution should be read together: the mean error of {m['overall_points_bias']:.3f} reveals the direction of bias, while the scatter plot exposes individual errors hidden by averages. Negative residuals indicate underprediction.\n\n"
    report+=f"Minutes MAE is {m['minutes']:.3f}, compared with {m['minutes_baseline']:.3f} for the five-round mean and {m['previous_minutes_baseline']:.3f} for the previous round. The 1–29-minute group should be read separately: entering the match does not mean the player receives a normal starting-player workload. The coverage graph shows how much each gameweek contributes and how many appearances are short.\n\n"
    report+='The position graph compares model and baseline within the same position. Lower absolute error for one position alone does not establish a better model for that position, because the points distributions differ. The ablation graph concerns model components; it is not a ranking of causal football factors.\n\n'
    primary=U[U.block_length.eq(3 if len(weekly)>=10 else 0)]
    if len(weekly)>=10:
        main=primary[(primary.task=='overall_points')&(primary.comparator=='baseline_points')].iloc[0]
        reduced=primary[(primary.task=='overall_points')&(primary.comparator=='Reduced')].iloc[0]
        report+=f"For risk-adjusted points, the equal-gameweek model-minus-baseline difference is {main.mean_difference:.4f}, with an adjusted interval [{main.family_low:.4f}, {main.family_high:.4f}]. The enriched-minus-reduced difference is {reduced.mean_difference:.4f}, with interval [{reduced.family_low:.4f}, {reduced.family_high:.4f}]. These answer different questions: improving on a simple historical baseline is not the same as establishing an advantage from the added features among players who actually appeared.\n\n"
    report+='### Statistical comparisons\n\n'+table(primary[~primary.comparator.isin(GROUPS)],['task','comparator','mean_difference']+(['family_low','family_high'] if len(weekly)>=10 else []))+'\n\n'
    report+='### Feature-group contributions\n\n'+table(primary[primary.comparator.isin(GROUPS)],['task','comparator','mean_difference']+(['family_low','family_high'] if len(weekly)>=10 else []))+'\n'
    (dest/'Report.md').write_text(report,encoding='utf-8')
    verification={'selected_rows':len(d),'players':int(d.player_id.nunique()),'zero_minutes_excluded':int((~mask).sum()),'configurations':len(frames),
       'all_keys_match':True,'all_outcomes_match':True,'no_retraining':True,'individual_graphs':len(list((dest/'players').glob('*.png'))),
       'source_sha256':{k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in files.items()}}
    assert verification['individual_graphs']==d.player_id.nunique()
    (dest/'verification.json').write_text(json.dumps(verification,indent=2))
    print(name,json.dumps(m),flush=True)

if __name__=='__main__':
    run(ROOT/'output/evaluation-enriched-gw21-38','2025-26')
    run(ROOT/'output/evaluation-cross-season-2026-27','2026-27')
    (OUT/'README.md').write_text('# All players with minutes > 0\n\n- [2025–26 GW21–38](2025-26/Report.md)\n- [2026–27 GW1–4](2026-27/Report.md)\n\nThese are outcome-selected diagnostics using unchanged saved forecasts. Zero-point and negative-point appearances are retained. The original all-player evaluation remains necessary. No thesis or PDF was changed.\n',encoding='utf-8')
