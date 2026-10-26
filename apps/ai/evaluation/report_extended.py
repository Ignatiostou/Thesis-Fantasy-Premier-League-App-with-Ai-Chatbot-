"""Regenerate GW21-38 diagnostics, top-player outputs and human-readable report."""
from pathlib import Path
import json,shutil
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import analyze_enriched as analysis
import evaluate_top_players as top
from extend_enriched import OUT,OLD

LABELS={'overall_points':'Risk-adjusted points','conditional_points':'Conditional points','participation':'Participation Brier','minutes':'Minutes'}

def table(d,columns):
 rows=['| '+' | '.join(columns)+' |','| '+' | '.join(['---']*len(columns))+' |']
 for _,r in d.iterrows():
  rows.append('| '+' | '.join(f'{r[c]:.4f}' if isinstance(r[c],(float,np.floating)) else str(r[c]) for c in columns)+' |')
 return '\n'.join(rows)

def main():
 analysis.ROOT=OUT;analysis.OUT=OUT/'analysis';analysis.main()
 top.SOURCE=OUT.resolve();top.OUT=(OUT/'top-players').resolve();top.END_GW=38;top.main()
 results=json.loads((top.OUT/'results.json').read_text())
 results['full_season_ranking_note']='Final-season cumulative points and minutes independently match the pinned final bootstrap for all 841 players; see source-outcome-verification.json. Original GW36-position selection retained for comparability.'
 (top.OUT/'results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
 d=pd.read_csv(OUT/'full_predictions.csv');red=pd.read_csv(OUT/'reduced_matched_predictions.csv');a=OUT/'analysis'
 S=pd.read_csv(a/'model_summary.csv');summary=json.loads((a/'summary.json').read_text())
 U=pd.read_csv(a/'comparison_uncertainty.csv');A=pd.read_csv(a/'ablation_uncertainty.csv')
 rows=[]
 for task,base in [('overall_points','baseline_points'),('conditional_points','baseline_conditional'),('participation','baseline_played'),('minutes','baseline_minutes'),('minutes','baseline_minutes_last')]:
  mask=d.actual_played.eq(1) if task=='conditional_points' else np.ones(len(d),dtype=bool)
  z=d[mask];r=red[mask];target='actual_played' if task=='participation' else 'actual_minutes' if task=='minutes' else 'actual_points'
  def loss(col,frame):
   e=frame[col]-frame[target];return (e**2 if task=='participation' else e.abs()).mean()
  rows.append({'Measure':LABELS[task]+(' (previous-round comparator)' if base=='baseline_minutes_last' else ''),'Enriched':loss(task,z),'Reduced':loss(task,r),'Baseline':loss(base,z)})
 metrics=pd.DataFrame(rows);metrics.to_csv(OUT/'headline_metrics.csv',index=False)
 # Additional conditional-forecast and confidence-interval figures.
 fig,ax=plt.subplots(figsize=(9,4))
 for frame,col,label in [(d,'conditional_points','Enriched'),(red,'conditional_points','Reduced'),(d,'baseline_conditional','Baseline')]:
  z=frame[frame.actual_played.eq(1)];v=(z[col]-z.actual_points).abs().groupby(z.gameweek).mean();ax.plot(v.index,v,'o-',label=label)
 ax.set(xlabel='Target gameweek',ylabel='Conditional points MAE');ax.legend();fig.tight_layout();fig.savefig(a/'12_conditional_points.png',dpi=170);plt.close(fig)
 fig,axes=plt.subplots(1,3,figsize=(12,4));fig.suptitle('Paired gameweek differences — marginal 95% block-bootstrap intervals')
 for ax,task in zip(axes,['overall_points','participation','minutes']):
  z=U[(U.task.eq(task)) & U.block_length.eq(3) & ~U.comparator.eq('reduced_matched')].reset_index(drop=True)
  for i,r in z.iterrows():ax.plot([r.ci95_low,r.ci95_high],[i,i],color='steelblue');ax.plot(r.mean_difference,i,'o',color='steelblue')
  ax.axvline(0,color='grey',ls='--');ax.set_yticks(range(len(z)),z.comparator.str.replace('baseline_','',regex=False));ax.set_title(LABELS[task]);ax.set_xlabel('Model loss minus baseline loss')
 fig.tight_layout();fig.savefig(a/'13_paired_intervals.png',dpi=170);plt.close(fig)
 # Human-readable tables with the requested terminology, while preserving the
 # existing internal column key for compatibility with prior scripts.
 for filename in ['model_summary.csv','comparison_uncertainty.csv','ablation_uncertainty.csv']:
  t=pd.read_csv(a/filename);t['task']=t.task.map(LABELS);t.to_csv(a/('labelled_'+filename),index=False)
 headline=U[U.block_length.eq(3)].copy();headline['task']=headline.task.map(LABELS)
 headline['95% interval']=headline.apply(lambda r:f'[{r.ci95_low:.4f}, {r.ci95_high:.4f}]',axis=1)
 headline['Adjusted interval']=headline.apply(lambda r:f'[{r.family_low:.4f}, {r.family_high:.4f}]',axis=1)
 topco=pd.DataFrame(results['cohorts'])
 gain=100*(1-metrics.iloc[0].Enriched/metrics.iloc[0].Baseline)
 text=f'''# ML evaluation extended to GW21–38

## What changed

The 2025–26 walk-forward evaluation now covers **18 gameweeks, GW21–38**, rather than 15. The results use **{len(d):,} player-gameweeks**, **{d.player_id.nunique()} players** and **{int(d.actual_played.sum()):,} appearances of at least 30 minutes**. The last three rounds add **{len(d[d.gameweek.ge(36)]):,} observations**.

The original GW21–35 input features, eligibility and outcome labels were checked against the extended dataset and found unchanged. Their saved predictions were retained. GW36 was trained on eligible outcomes through GW35, GW37 through GW36, and GW38 through GW37. Pre-deadline metadata for GW36–38 were used. No future target outcomes entered training. Hyperparameters and seeds remain the same; there was no tuning on the added rounds.

All eleven configurations were extended: enriched, reduced, and nine feature-group removals. This required **99 new model fits** (11 configurations × 3 new rounds × 3 models). Together with the earlier folds the evaluation represents 594 fits. Training examples start at GW6 because five earlier calendar rounds are required for history. The production application and models were not changed.

## Terminology

**Risk-adjusted points** means conditional predicted points multiplied by the predicted probability of playing at least 30 minutes. Conditional points are evaluated only on actual appearances of at least 30 minutes; risk-adjusted points are evaluated across all eligible observations. The existing formula omits a separate contribution from appearances shorter than 30 minutes, so it approximates expected points. Internal data retain the legacy key `overall_points` for script compatibility; reports and chart labels use Risk-adjusted points.

## Updated results

Lower values are better. Points and minutes use MAE; participation uses Brier score. The baseline is the previous five rounds, except where the previous-round minutes comparator is explicitly shown. Conditional baseline predictions use qualifying historical appearances with the same training-only fallback as before.

'''+table(metrics,['Measure','Enriched','Reduced','Baseline'])+f'''

Risk-adjusted points MAE is **{metrics.iloc[0].Enriched:.3f}**, versus **{metrics.iloc[0].Baseline:.3f}** for the baseline, a **{gain:.1f}% reduction**. These are pooled row-weighted errors. They should replace GW21–35 headline figures when describing this expanded ML experiment, but not the separate recommendation experiments that still use GW21–35.

![Risk-adjusted points error](analysis/01_points_mae.png)
![Conditional points error](analysis/12_conditional_points.png)
![Mean actual points and risk-adjusted predictions](analysis/02_mean_points.png)
![Minutes error](analysis/03_minutes_mae.png)

## Statistical comparisons

The paired analysis was recalculated using all 18 round-level differences. It uses 100,000 circular block-bootstrap samples, seed 20260915, primary block length 3, and sensitivity lengths 2 and 5. Each round receives equal weight, unlike the pooled headline metrics. Negative model-minus-comparator differences favour the enriched model.

'''+table(headline,['task','comparator','mean_difference','95% interval','Adjusted interval'])+'''

The adjusted intervals account for nine headline comparisons. Nine feature groups × four tasks form a separate family of 36 exploratory comparisons. These two families are not one joint family. Intervals remain approximate with only 18 rounds and assume enough temporal stability for circular block resampling. Models are not refitted inside the bootstrap, so intervals condition on the fitted predictions. This is retrospective evaluation, not proof of future-season performance.

![Paired uncertainty](analysis/13_paired_intervals.png)

## Feature-group contributions

Every removal uses identical evaluation rows and the same training procedure. A positive removed-minus-full difference means removing the group worsened that task. It does not establish a causal contribution, and correlated groups can substitute for each other. The full tables include marginal and family-adjusted intervals at all three block lengths.

![Nine feature-group removals](analysis/11_ablation_intervals.png)

## Error and probability diagnostics

'''+f'''There are **{int(d.actual_points.eq(0).sum()):,} zero-point observations ({100*d.actual_points.eq(0).mean():.1f}%)**. This remains important when interpreting the all-player MAE. The model's mean signed risk-adjusted error is **{(d.overall_points-d.actual_points).mean():.3f}**, and **{100*(d.overall_points-d.actual_points).abs().le(2).mean():.1f}%** of predictions lie within two points, including non-playing players. Participation ROC-AUC is **{summary['probability']['enriched']['auc']:.4f}**. Calibration plots and grouped errors show limitations hidden by averages.

'''+'''![Probability calibration](analysis/04_calibration.png)
![Actual versus risk-adjusted points](analysis/05_scatter.png)
![Error distribution](analysis/06_errors.png)
![Position-level errors](analysis/07_position.png)
![Coverage](analysis/09_coverage.png)
![Participation ROC-AUC](analysis/10_auc.png)

## Top-player diagnostic

The original top 5 goalkeepers, 15 defenders, 15 midfielders and 10 forwards are retained, selected by final 2025–26 points and their archived GW36 positions. This is an outcome-selected diagnostic, not a realistic pre-season selection rule. The complete season totals now match the pinned final bootstrap for all 841 recorded players. Selected IDs are checked against the original cohort.

'''+table(topco,['cohort','n','overall_mae','baseline_mae','conditional_mae','conditional_baseline_mae']).replace('overall_mae','Risk-adjusted MAE')+'''

Individual graphs show actual points, risk-adjusted and conditional predictions, and accumulated weekly forecasts through GW38. Cumulative predictions sum separate weekly forecasts; they are not a single 18-week forecast issued before GW21. All 45 individual graphs and eight detailed position graphs are in `top-players/`.

![Top-player position summary](top-players/position_summary.png)

## Scope and files

The extension does not resolve the existing historical fixture/opponent limitations or cover cold starts excluded by the five-round-history rule. The separate 2026–27 GW1–4 experiment covers cross-season transfer and must remain separately reported. Days 6–8 recommendation and optimisation results still refer to their original windows; they were not silently expanded by this ML extension.

The old GW21–35 artifacts remain preserved. This directory contains the new predictions, per-fold reports, protocol, analysis, top-player results and verification record. Run `extend_enriched.py` once into a new output directory, followed by `report_extended.py`; `verify_extended.py` validates the completed outputs. The cross-season report's terminology was updated without changing its predictions.
'''
 (OUT/'Report.md').write_text(text,encoding='utf-8')
 for name in ['report_extended.py','evaluate_top_players.py']:shutil.copy2(Path(__file__).parent/name,OUT/name)
 print(metrics.to_string(index=False),flush=True)

if __name__=='__main__':main()
