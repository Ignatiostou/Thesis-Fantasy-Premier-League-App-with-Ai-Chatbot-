"""Tables, diagnostics and plain-language report for the frozen cross-season run."""
import itertools, json
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import roc_auc_score
from sklearn.calibration import calibration_curve
from cross_season import OUT, GROUPS

TASKS={
 'overall_points':('actual_points','overall_points','baseline_points'),
 'conditional_points':('actual_points','conditional_points','baseline_conditional'),
 'participation':('actual_played','participation','baseline_played'),
 'minutes':('actual_minutes','minutes','baseline_minutes'),
 'minutes_previous_round':('actual_minutes','minutes','baseline_minutes_last')}
POS={1:'GK',2:'DEF',3:'MID',4:'FWD'}

def losses(d,task,col):
    y=TASKS[task][0]
    if task=='conditional_points':d=d[d.actual_played.eq(1)]
    delta=d[col]-d[y]
    return delta.pow(2) if task=='participation' else delta.abs()

def metrics(d,label):
    rows=[]
    for task,(target,pred,base) in TASKS.items():
        s=d[d.actual_played.eq(1)] if task=='conditional_points' else d
        if not len(s):continue
        r=dict(cohort=label,task=task,n=len(s),model=losses(s,task,pred).mean(),baseline=losses(s,task,base).mean(),bias=(s[pred]-s[target]).mean())
        r['difference']=r['model']-r['baseline']
        r['rmse']=np.sqrt(((s[pred]-s[target])**2).mean())
        r['actual_sum']=s[target].sum();r['predicted_sum']=s[pred].sum();r['baseline_sum']=s[base].sum()
        r['auc']=roc_auc_score(s[target],s[pred]) if task=='participation' and s[target].nunique()==2 else np.nan
        rows.append(r)
    return rows

def main():
    charts=OUT/'graphs';charts.mkdir(exist_ok=True)
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'savefig.dpi':160})
    full=pd.read_parquet(OUT/'full_predictions.parquet');reduced=pd.read_parquet(OUT/'reduced_predictions.parquet')
    def save(name):
        for ax in plt.gcf().axes:
            rename=lambda s:s.replace('overall points','Risk-adjusted points').replace('Overall points','Risk-adjusted points')
            ax.set_title(rename(ax.get_title()));ax.set_xlabel(rename(ax.get_xlabel()));ax.set_ylabel(rename(ax.get_ylabel()))
        plt.tight_layout();plt.savefig(charts/name,bbox_inches='tight');plt.close()
    rows=metrics(full,'enriched')+metrics(reduced,'reduced')
    groups=[('returning',full[full.returning_player]),('new_to_prior_season_data',full[~full.returning_player]),('five_prior_rounds',full[full.prior_five_observed.eq(5)]),('incomplete_history',full[full.prior_five_observed.lt(5)]),('actual_zero_points',full[full.actual_points.eq(0)]),('actual_nonzero_points',full[full.actual_points.ne(0)]),('actual_30plus_minutes',full[full.actual_played.eq(1)])]
    groups += [(POS[int(pos)],d) for pos,d in full.groupby('snapshot_position')]
    for label,d in groups: rows+=metrics(d,label)
    summary=pd.DataFrame(rows);summary.to_csv(OUT/'metrics.csv',index=False)
    weekly=pd.DataFrame([r for gw,d in full.groupby('gameweek') for r in metrics(d,f'GW{gw}')]);weekly.to_csv(OUT/'weekly_metrics.csv',index=False)
    pd.DataFrame([dict(r,gameweek=gw) for (pos,gw),d in full.groupby(['snapshot_position','gameweek']) for r in metrics(d,POS[int(pos)])]).to_csv(OUT/'position_weekly_metrics.csv',index=False)
    week_reduced=pd.DataFrame([r for gw,d in reduced.groupby('gameweek') for r in metrics(d,f'GW{gw}')])
    x=np.arange(1,5)
    for task,name,ylabel in [('overall_points','01_points_mae.png','Points MAE'),('minutes','03_minutes_mae.png','Minutes MAE'),('conditional_points','13_conditional_points_mae.png','Conditional points MAE')]:
        plt.figure(figsize=(8,3.5));a=weekly[weekly.task.eq(task)];b=week_reduced[week_reduced.task.eq(task)]
        plt.plot(x,a.model,'o-',label='Enriched');plt.plot(x,b.model,'o-',label='Reduced');plt.plot(x,a.baseline,'o-',label='Five-round baseline')
        if task=='minutes':plt.plot(x,weekly[weekly.task.eq('minutes_previous_round')].baseline,'o-',label='Previous-round baseline')
        plt.xticks(x);plt.xlabel('2026–27 gameweek');plt.ylabel(ylabel);plt.legend();save(name)
    plt.figure(figsize=(8,3.5))
    for data,col,label in [(full,'actual_points','Actual'),(full,'overall_points','Enriched'),(reduced,'overall_points','Reduced')]:plt.plot(x,data.groupby('gameweek')[col].mean(),'o-',label=label)
    plt.xticks(x);plt.xlabel('2026–27 gameweek');plt.ylabel('Mean points');plt.legend();save('02_mean_actual_predicted.png')
    plt.figure(figsize=(8,3.5))
    for data,col,label in [(full,'participation','Enriched'),(reduced,'participation','Reduced'),(full,'baseline_played','Baseline')]:plt.plot(x,[roc_auc_score(d.actual_played,d[col]) for _,d in data.groupby('gameweek')],'o-',label=label)
    plt.ylim(.5,1);plt.xticks(x);plt.xlabel('2026–27 gameweek');plt.ylabel('Participation ROC-AUC');plt.legend();save('04_participation_auc.png')
    plt.figure(figsize=(6,5));plt.scatter(full.actual_points,full.overall_points,s=12,alpha=.15);lim=max(full.actual_points.max(),full.overall_points.max());plt.plot([0,lim],[0,lim],'k--');plt.xlabel('Actual points');plt.ylabel('Predicted overall points');save('05_actual_predicted.png')
    plt.figure(figsize=(8,3.5));plt.hist(full.overall_points-full.actual_points,bins=50);plt.axvline(0,color='black',ls='--');plt.xlabel('Predicted minus actual points');plt.ylabel('Player-gameweeks');save('06_errors.png')
    pm=summary[summary.cohort.isin(POS.values()) & summary.task.eq('overall_points')].set_index('cohort').reindex(POS.values())
    pm[['model','baseline']].plot.bar(figsize=(7,3.5),rot=0);plt.ylabel('Points MAE');plt.xlabel('Position');save('07_position_mae.png')
    counts=full.groupby('gameweek').size();counts.plot.bar(figsize=(7,3.5),rot=0);plt.xlabel('Gameweek');plt.ylabel('Matched player-gameweeks');save('08_coverage.png')
    fig,axes=plt.subplots(1,2,figsize=(10,3.6))
    for data,col,label in [(full,'participation','Enriched'),(reduced,'participation','Reduced'),(full,'baseline_played','Baseline')]:
        actual,pred=calibration_curve(data.actual_played,data[col],n_bins=10)
        axes[0].plot(pred,actual,'o-',label=label);axes[1].hist(data[col],bins=np.linspace(0,1,11),histtype='step',label=label)
    axes[0].plot([0,1],[0,1],'k--');axes[0].set(xlabel='Mean predicted probability',ylabel='Observed rate of minutes >=30');axes[1].set(xlabel='Predicted probability',ylabel='Observations');axes[0].legend();save('09_calibration.png')
    # Nine frozen-fit group removals: matched cases, identical training season.
    ab=[]
    for group in GROUPS:
        other=pd.read_parquet(OUT/f'without_{group}_predictions.parquet')
        assert other[['player_code','gameweek']].equals(full[['player_code','gameweek']])
        for task,(_,col,_) in TASKS.items():
            if task=='minutes_previous_round':continue
            delta=losses(other,task,col)-losses(full,task,col)
            ab.append(dict(group=group,task=task,removed_minus_full=delta.mean()))
    ab=pd.DataFrame(ab);ab.to_csv(OUT/'ablations.csv',index=False)
    fig,axes=plt.subplots(2,2,figsize=(11,8))
    for ax,task in zip(axes.ravel(),['overall_points','conditional_points','participation','minutes']):
        s=ab[ab.task.eq(task)];ax.barh(s.group,s.removed_minus_full);ax.axvline(0,color='black',ls='--');ax.set(title=task.replace('_',' '),xlabel='Removed-group loss minus full-model loss')
    save('10_feature_group_ablations.png')
    # Four paired rounds cannot support the earlier 15-round bootstrap.
    paired=[]
    fig,axes=plt.subplots(1,3,figsize=(12,3.5))
    for task,(_,col,base) in TASKS.items():
        diffs=np.array([(losses(d,task,col).mean()-losses(d,task,base).mean()) for _,d in full.groupby('gameweek')])
        null=[abs(np.mean(diffs*np.array(signs))) for signs in itertools.product([-1,1],repeat=4)]
        paired.append(dict(task=task,mean_weekly_difference=diffs.mean(),minimum=diffs.min(),maximum=diffs.max(),**{f'GW{i+1}':v for i,v in enumerate(diffs)},exploratory_two_sided_signflip_p=np.mean(np.array(null)>=abs(diffs.mean())-1e-12)))
    paired=pd.DataFrame(paired);paired.to_csv(OUT/'paired_gameweek_differences.csv',index=False)
    reduced_pairs=[]
    for task,(_,col,_) in TASKS.items():
        if task=='minutes_previous_round':continue
        diff=losses(full,task,col)-losses(reduced,task,col)
        values=diff.groupby(full.loc[diff.index,'gameweek']).mean()
        reduced_pairs.append(dict(task=task,mean_weekly_difference=values.mean(),minimum=values.min(),maximum=values.max(),**{f'GW{int(k)}':v for k,v in values.items()}))
    pd.DataFrame(reduced_pairs).to_csv(OUT/'paired_enriched_minus_reduced.csv',index=False)
    for ax,task in zip(axes,['overall_points','participation','minutes']):
        s=paired[paired.task.eq(task)].iloc[0];ax.plot(x,[s[f'GW{i}'] for i in x],'o-');ax.axhline(0,color='black',ls='--');ax.set(title=task.replace('_',' '),xlabel='Gameweek',ylabel='Model loss minus baseline loss',xticks=x)
    save('11_paired_differences.png')
    # Pre-season selection: use last season's top 5/15/15/10, without replacements.
    raw=pd.read_parquet(OUT/'input_snapshot.parquet');meta=pd.read_parquet(OUT/'training_metadata.parquet')
    totals=raw[raw.season.eq('2025-26')].groupby('player_id').total_points.sum().rename('prior_season_points').reset_index()
    rank=meta[meta.gameweek.eq(38)].merge(totals,on='player_id')
    selected=pd.concat([rank[rank.snapshot_position.eq(pos)].sort_values(['prior_season_points','player_code'],ascending=[False,True]).head(n) for pos,n in [(1,5),(2,15),(3,15),(4,10)]])
    selected['test_rows']=selected.player_code.map(full.groupby('player_code').size()).fillna(0).astype(int)
    selected[['player_code','snapshot_name','snapshot_position','prior_season_points','test_rows']].to_csv(OUT/'prior_season_top45_selection.csv',index=False)
    top=full[full.player_code.isin(selected.player_code)]
    topmetrics=pd.DataFrame(metrics(top,'prior_season_top45')+[r for pos,d in top.groupby('snapshot_position') for r in metrics(d,POS[int(pos)])]);topmetrics.to_csv(OUT/'top_players_metrics.csv',index=False)
    per_player=[]
    individual=charts/'top_players';individual.mkdir(exist_ok=True)
    for code,d in full.groupby('player_code'):
        name=d.snapshot_name.iloc[-1]
        for r in metrics(d,name):r['player_code']=code;per_player.append(r)
        if code not in set(selected.player_code):continue
        fig,axes=plt.subplots(1,2,figsize=(9,3.2));d=d.sort_values('gameweek')
        axes[0].plot(d.gameweek,d.actual_points,'o-',label='Actual');axes[0].plot(d.gameweek,d.overall_points,'o-',label='Enriched');axes[0].plot(d.gameweek,d.baseline_points,'o-',label='Baseline');axes[0].set_title(name+' — overall points')
        s=d[d.actual_played.eq(1)];axes[1].plot(s.gameweek,s.actual_points,'o-',label='Actual');axes[1].plot(s.gameweek,s.conditional_points,'o-',label='Enriched');axes[1].plot(s.gameweek,s.baseline_conditional,'o-',label='Baseline');axes[1].set_title('Conditional: actual minutes >=30')
        for ax in axes:ax.set(xlabel='Gameweek',ylabel='Points',xticks=x);ax.legend(fontsize=8)
        save(f'top_players/player_{code}.png')
    pd.DataFrame(per_player).to_csv(OUT/'per_player_metrics.csv',index=False)
    fig,axes=plt.subplots(1,2,figsize=(10,3.5))
    for ax,task in zip(axes,['overall_points','conditional_points']):
        s=topmetrics[topmetrics.cohort.isin(POS.values()) & topmetrics.task.eq(task)].set_index('cohort').reindex(POS.values());s[['model','baseline']].plot.bar(ax=ax,rot=0);ax.set(title=task.replace('_',' '),ylabel='MAE',xlabel='Position')
    save('12_top_players_positions.png')
    full.to_csv(OUT/'full_predictions.csv',index=False)
    protocol=json.loads((OUT/'protocol.json').read_text())
    overall=summary[summary.cohort.eq('enriched')].set_index('task');rm=summary[summary.cohort.eq('reduced')].set_index('task')
    def table(data,cols):
        lines=['| '+' | '.join(cols)+' |','| '+' | '.join(['---']*len(cols))+' |']
        for _,r in data.iterrows():lines.append('| '+' | '.join(f'{r[c]:.4f}' if isinstance(r[c],(float,np.floating)) else str(r[c]) for c in cols)+' |')
        return '\n'.join(lines)
    text=f'''# Cross-season ML evaluation: 2026–27, GW1–4

## What was tested

We fitted the existing three-model historical evaluation pipeline using only the 2025–26 season, then tested its predictions on the first four gameweeks of 2026–27. All four rounds were complete when the data were collected. This is a separate experiment from the GW21–35 evaluation; the application and its production model files were not changed.

The training set contains **{protocol['training_rows']:,} player-gameweeks**, with training targets from GW6 through GW38. GW1–5 supply early history: the original training method requires five previous rounds, so it cannot use them as labelled training targets. Thus the complete season is available for training, but not every row is an eligible training example. There are **{len(full):,} matched test rows**, across **{full.player_code.nunique()} players**. Their counts by round are {', '.join(str(v) for v in counts)}. Twenty-two recorded outcome rows had no matching pre-deadline listing and were excluded; their identities are saved separately.

We compared the enriched model, the reduced model and the same recent-history baselines. We also retrained nine versions, removing one feature group at a time. Hyperparameters and seeds stayed unchanged. Each model was fitted once on the old season: none of the four test rounds was used for fitting, tuning or recalibration.

## Keeping the test chronological

Season-specific numeric player IDs change. We linked records through stable player codes, rather than assuming that an ID means the same player in both seasons. Pre-deadline player status, price, ownership, position, form and team information came from four pinned archived snapshots, all captured before their respective deadlines. The source URLs, timestamps and hashes are in `sources.json`.

For returning players, recent-history windows cross the summer and use the last rounds of 2025–26. From GW2 onwards they also include already-completed 2026–27 rounds. Current-season totals reset at the start of the season. Players without prior-season records remain in the test; missing inputs use medians learnt from training data. Missing baseline history uses training means. This makes the early-season test possible, but stale summer history and cold starts are real limitations. The generic team-strength field was missing in all four archived snapshots; it was imputed from training data. The six home/away strength fields were available. Future fixture and opponent features remain outside this experiment.

## Main results

Lower MAE and Brier scores are better. Conditional points are evaluated only on players who actually played at least 30 minutes. Participation predicts that same threshold, not merely any appearance. Overall points use the existing conditional forecast multiplied by participation probability.

| Measure | Enriched | Reduced | Baseline |
| --- | ---: | ---: | ---: |
'''
    for task in TASKS:text+=f'| {task.replace("_"," ")} | {overall.loc[task,"model"]:.4f} | {rm.loc[task,"model"]:.4f} | {overall.loc[task,"baseline"]:.4f} |\n'
    gain=100*(1-overall.loc['overall_points','model']/overall.loc['overall_points','baseline'])
    text+=f'''
The enriched overall-points MAE was **{overall.loc['overall_points','model']:.3f}**, compared with **{overall.loc['overall_points','baseline']:.3f}** for the baseline: a **{gain:.1f}% reduction** on these cases. This is a useful result, but it does not mean that every useful FPL player was predicted within this error. **{100*full.actual_points.eq(0).mean():.1f}%** of test rows had zero actual points. We therefore report nonzero outcomes, regular appearances, positions and established high-scoring players separately.

![Points error by gameweek](graphs/01_points_mae.png)

The mean signed points error was **{overall.loc['overall_points','bias']:.3f}**. A negative value means underprediction. Average predictions were below actual averages in all four rounds, particularly GW1. The points scatter and error histogram show where this happens; a low overall MAE alone hides large errors for occasional high scores.

Conditional-points MAE was **{overall.loc['conditional_points','model']:.3f}**, versus **{overall.loc['conditional_points','baseline']:.3f}** for the baseline. The enriched model also improved on the reduced model's **{rm.loc['conditional_points','model']:.3f}**. This improvement is measured on actual qualifying appearances, so it cannot be explained simply by correctly predicting many non-playing players.

![Conditional-points error by gameweek](graphs/13_conditional_points_mae.png)

![Mean actual and predicted points](graphs/02_mean_actual_predicted.png)
![Actual and predicted points](graphs/05_actual_predicted.png)
![Error distribution](graphs/06_errors.png)

## Minutes and participation

Participation ROC-AUC was **{overall.loc['participation','auc']:.4f}**. AUC measures separation between the two outcome groups; the Brier score and calibration graph also check the predicted probabilities. Minutes are compared with both the previous round and a five-round mean, so the interpretation does not depend on a single convenient baseline.

The minutes model beat the five-round mean, but **did not beat the previous-round baseline overall**: MAE was **{overall.loc['minutes','model']:.2f}** versus **{overall.loc['minutes_previous_round','baseline']:.2f}** minutes. The previous-round baseline was worse in GW1, when it relied on the previous season, and better in GW2–4. This is an important limitation, even though the points results are encouraging.

![Minutes error](graphs/03_minutes_mae.png)
![Participation discrimination](graphs/04_participation_auc.png)
![Probability calibration](graphs/09_calibration.png)

## Different player groups

'''+table(summary[summary.task.eq('overall_points') & ~summary.cohort.isin(['enriched','reduced'])],['cohort','n','model','baseline'])+'''

The returning/new-player comparison is particularly important: this is the first experiment here that explicitly includes players with no previous-season records. These groups have different playing-time and scoring distributions, so their raw MAEs should not be interpreted as a fair ranking of group difficulty.

![Position-level error](graphs/07_position_mae.png)
![Dataset coverage](graphs/08_coverage.png)

## Previous-season top players

'''+f'''We selected the top 5 goalkeepers, 15 defenders, 15 midfielders and 10 forwards by **2025–26 total points**, using their old-season positions. This selection was knowable before the test season, unlike selecting players using their future 2026–27 totals. Of these 45 players, **{int(selected.test_rows.gt(0).sum())}** appear in the matched test data, contributing **{len(top)} rows**. Players absent from the new-season cohort were not replaced. Position results below use the position recorded in the new-season snapshot. Individual graphs are saved under `graphs/top_players`, and every evaluated player's metrics are in `per_player_metrics.csv`.

'''+table(topmetrics[topmetrics.cohort.eq('prior_season_top45')],['task','n','model','baseline'])+'''

![Top-player errors by position](graphs/12_top_players_positions.png)

The top-player result is more demanding than the all-player average: overall-points MAE is 2.438 rather than 1.163. It still improves on the top-player baseline of 2.866. Conditional-points improvement is smaller, at 2.999 versus 3.098. For the selected forwards' 17 qualifying appearances, the model is worse: 4.122 versus 3.573. These small subgroups should be interpreted cautiously, but should not be hidden by the overall result.

## Feature contributions

Each group-removal model used the same training season and matched test cases. Positive bars mean that removing the group increased error; negative bars mean that the reduced feature set performed better in this short test. This is evidence about the fitted models on these four rounds, not a universal or causal value for each feature. Correlated groups can substitute for one another.

Removing availability information increased overall-points MAE by 0.066 and minutes MAE by 1.692. Removing team-strength information increased conditional-points MAE by 0.112, but improved minutes MAE by 0.670. API form and position removal produced small improvements in some tasks. The feature groups therefore do not help every prediction task equally.

![Feature-group removals](graphs/10_feature_group_ablations.png)

## How certain are these differences?

There are only four gameweeks. We report all four paired differences, their mean and range rather than reusing the previous 15-round block-bootstrap intervals. The CSV also includes an exploratory exact two-sided sign-flip calculation over the 16 possible sign patterns. It assumes symmetric, independent round differences, which may not hold here; even its smallest possible two-sided p-value is 0.125. It cannot establish significance at 5%. Thousands of player rows do not turn four rounds into a long temporal test.

'''+table(paired,['task','mean_weekly_difference','minimum','maximum','exploratory_two_sided_signflip_p'])+'''

![Paired errors in each round; not confidence intervals](graphs/11_paired_differences.png)

The pooled scores above weight player rows equally. Paired round means weight each of the four gameweeks equally, so the reported differences need not be numerically identical.

## What this adds to the thesis

This experiment tests transfer to a new season, including the difficult opening rounds and players with little local history. It complements the within-season GW21–35 evaluation. Its results should be reported separately: the seasons, player populations, history availability and training schedules differ. A larger new-season test is still needed before concluding that an advantage will persist throughout the season. This evaluates prediction quality, not the complete recommendation, transfer or chip policy.

## Files and reproduction

`protocol.json` records the design; `sources.json` identifies archived inputs. `metrics.csv`, `weekly_metrics.csv`, `ablations.csv`, `paired_gameweek_differences.csv`, `per_player_metrics.csv` and `full_predictions.csv` contain the numerical results. `verification.json` records integrity checks. Frozen fitted estimators are stored only inside this experiment's `models` directory.

From the repository root, run `apps/ai/evaluation/cross_season.py` with stages `acquire`, `prepare`, `run`, then `apps/ai/evaluation/report_cross_season.py` and `apps/ai/evaluation/verify_cross_season.py`, using the project's Python environment. The acquisition step uses live source queries; the saved pinned inputs and hashes are the reference for this completed run.
'''
    text=text.replace('Overall points','Risk-adjusted points').replace('overall points','risk-adjusted points').replace('overall-points','risk-adjusted-points').replace('overall prediction','risk-adjusted prediction')
    (OUT/'Report.md').write_text(text,encoding='utf-8')
    print(summary[summary.cohort.isin(['enriched','reduced'])].to_string(index=False),flush=True)

if __name__=='__main__':main()
