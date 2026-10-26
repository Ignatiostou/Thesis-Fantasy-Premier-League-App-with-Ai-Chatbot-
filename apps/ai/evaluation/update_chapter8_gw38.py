"""Replace Chapter 8.2 values/figures from verified GW21-38 outputs. No PDF build."""
from pathlib import Path
import re,json,shutil,hashlib
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

ROOT=Path('output/evaluation-enriched-gw21-38');A=ROOT/'analysis';T=ROOT/'top-players'
CH=Path('Thesis/chapter-8/8-evaluation.md');FIG=CH.parent/'figures/ml'

def main():
 assert json.loads((ROOT/'verification.json').read_text())['status']=='PASS'
 backup=ROOT/'chapter8-before-gw38';backup.mkdir(exist_ok=True)
 if not (backup/CH.name).exists():shutil.copy2(CH,backup/CH.name);shutil.copytree(FIG,backup/'figures',dirs_exist_ok=True)
 original=CH.read_text(encoding='utf-8');ui,ml=original.split('## Machine-Learning Evaluation',1)
 d=pd.read_csv(ROOT/'full_predictions.csv');r=pd.read_csv(ROOT/'reduced_matched_predictions.csv')
 S=pd.read_csv(A/'model_summary.csv');U=pd.read_csv(A/'comparison_uncertainty.csv');U=U[U.block_length.eq(3)]
 ab=pd.read_csv(A/'ablation_uncertainty.csv');ab=ab[ab.block_length.eq(3)]
 summary=json.loads((A/'summary.json').read_text());p=summary['probability']
 top=json.loads((T/'results.json').read_text());allc,tc,_=top['cohorts'];players=pd.DataFrame(top['players']);positions=pd.DataFrame(top['positions'])
 gw=pd.read_csv(A/'by_gameweek.csv');cal=pd.read_csv(A/'calibration_bins.csv');high=cal[cal.method.eq('enriched') & cal.bin.eq(9)].iloc[0]
 full=S[S.configuration.eq('full')].set_index('task');reduced=S[S.configuration.eq('reduced_matched')].set_index('task')
 def para(prefix,text):
  nonlocal ml
  pattern=r'(?m)^'+re.escape(prefix)+r'[^\n]*(?:\n(?!\n)[^\n]+)*'
  ml,n=re.subn(pattern,lambda _:text,ml,count=1);assert n==1,prefix
 def tab(identifier,headers,rows):
  nonlocal ml
  block='| '+' | '.join(headers)+' |\n| '+' | '.join([':---']+['---:']*(len(headers)-1))+' |\n'
  block+='\n'.join('| '+' | '.join(map(str,row))+' |' for row in rows)
  pattern=r'(?m)^\|[^\n]*\n(?:\|[^\n]*\n)*\n(?=Table: [^\n]*\{#tbl:'+identifier+r'\})'
  ml,n=re.subn(pattern,lambda _:block+'\n\n',ml);assert n==1,identifier
 ml=ml.replace('21-35','21-38').replace('gameweek 35','gameweek 38').replace('15 gameweeks','18 gameweeks').replace('15 evaluated gameweeks','18 evaluated gameweeks').replace('495 model fits','594 model fits')
 para('The evaluation covers',f'The evaluation covers gameweeks 21-38 of the 2025-26 season. It contains **{len(d):,} player-gameweek observations**, representing **{d.player_id.nunique()} players**. A player-gameweek observation contains the information available before a particular gameweek and the player\'s recorded outcome in that gameweek. Of these observations, **{int(d.actual_played.sum()):,} involved appearances of at least 30 minutes**. This threshold defines participation for the classification model and determines which observations are used to evaluate conditional points predictions.')
 para('The number of evaluated observations',f'The number of evaluated observations increased from **{int(gw.iloc[0].n)} in gameweek 21 to {int(gw.iloc[-1].n)} in gameweek 38**. Both configurations were evaluated on these same observations. However, this population includes players who did not play, which needs to be considered when interpreting the risk-adjusted points error.')
 rows=[]
 for label,task,base in [('Conditional points MAE','conditional_points','baseline_conditional'),('Risk-adjusted points MAE','overall_points','baseline_points'),('Participation Brier','participation','baseline_played'),('Minutes MAE: five-round baseline','minutes','baseline_minutes'),('Minutes MAE: previous-round baseline','minutes','baseline_minutes_last')]:
  z=d[d.actual_played.eq(1)] if task=='conditional_points' else d;target='actual_played' if task=='participation' else 'actual_minutes' if task=='minutes' else 'actual_points';e=z[base]-z[target];b=(e**2 if task=='participation' else e.abs()).mean();digits=5 if task=='participation' else 4
  vals=[b,reduced.loc[task,'loss'],full.loc[task,'loss']];rows.append([label]+[('**' if v==min(vals) else '')+f'{v:.{digits}f}'+('**' if v==min(vals) else '') for v in vals])
 tab('mlresults',['Metric','Baseline','Reduced','Enriched'],rows)
 gains={task:100*(1-full.loc[task,'loss']/reduced.loc[task,'loss']) for task in full.index}
 para('The enriched configuration improved all four metrics',f'The enriched configuration improved all four metrics compared with the reduced configuration. Risk-adjusted points MAE decreased by **{gains["overall_points"]:.2f}%**, participation Brier score by **{gains["participation"]:.2f}%**, and minutes MAE by **{gains["minutes"]:.2f}%**. The improvement in conditional points was smaller, at **{gains["conditional_points"]:.2f}%**. The largest relative improvement concerned participation, suggesting that the added information was particularly useful for estimating whether a player would make a qualifying appearance.')
 lo=gw.loc[gw.points_mae.idxmin()];hi=gw.loc[gw.points_mae.idxmax()]
 assert (gw.points_mae<gw.points_baseline_mae).all()
 para('The enriched configuration achieved lower risk-adjusted points MAE',f'The enriched configuration achieved lower risk-adjusted points MAE than both comparators in **all 18 gameweeks**. Its error ranged from approximately **{lo.points_mae:.3f} points in gameweek {int(lo.gameweek)}** to **{hi.points_mae:.3f} points in gameweek {int(hi.gameweek)}**. The differences were not equally large in every round. Nevertheless, the improvement was spread across the evaluation period rather than coming from a single unusually successful gameweek.')
 para("The enriched model's risk-adjusted points RMSE",f'The enriched model\'s risk-adjusted points RMSE was **{full.loc["overall_points","rmse"]:.3f}**, compared with an MAE of **{full.loc["overall_points","loss"]:.3f}**. The larger RMSE indicates that some predictions had substantially greater errors than the average.')
 last=(d.minutes-d.actual_minutes).abs().mean();lastb=(d.baseline_minutes_last-d.actual_minutes).abs().mean()
 para('The enriched configuration improved on the five-round average',f'The enriched configuration improved on the five-round average, but did not achieve the lowest pooled error among all methods. The previous-round baseline produced an MAE of **{lastb:.3f} minutes**, compared with **{last:.3f} minutes** for the enriched model.')
 para('Across the complete evaluation,',f'Across the complete evaluation, the mean signed error was only **{(d.overall_points-d.actual_points).mean():.3f} points**. However, a small average bias can hide larger errors in opposite directions across individual rounds. Agreement between averages should therefore not be interpreted as accurate prediction of every gameweek.')
 para('Most errors were concentrated',f'Most errors were concentrated near zero, and **{allc["within2_pct"]:.2f}% of predictions were within two points** of the recorded outcome. However, the evaluation included **{allc["zero_minutes_n"]:,} zero-minute observations**, approximately **{100*allc["zero_minutes_n"]/len(d):.1f}%** of the population. Correctly assigning low predictions to these observations contributes substantially to this result. The distribution also has a long negative tail, showing cases in which players scored considerably more than predicted.')
 para('The overall evaluation produced',f'The full-population evaluation produced a risk-adjusted points MAE of **{allc["overall_mae"]:.3f}**, but **{100*allc["zero_points_n"]/len(d):.1f}% of the evaluated observations had zero actual points**. Zero-point outcomes and zero-minute observations are different groups: a player can appear without scoring any points. This raised a practical question: how accurately does the model predict players who score highly over the season?')
 para('To examine this, the',f'To examine this, the **five highest-scoring goalkeepers, 15 defenders, 15 midfielders and 10 forwards** were selected, using their recorded total points in the 2025-26 season. Their existing predictions for gameweeks 21-38 were then evaluated. All 45 players had predictions for every gameweek, giving **{tc["n"]} player-gameweek observations**. Of these, **{tc["qualifying_n"]} involved appearances of at least 30 minutes** and were also used to evaluate conditional points predictions. The models were not retrained specifically for this cohort.')
 para('The players were selected using', 'The players were selected using their final season totals. This makes the analysis retrospective: it examines performance on players who eventually scored highly, without claiming that these players could have been identified in advance. Rankings use full-season totals and archived GW36 position labels; ties were resolved by player identifier. The original 45-player selection was retained for comparability. Cumulative points and minutes over the complete season were independently checked against a pinned final-season bootstrap snapshot for all 841 recorded players.')
 tab('mltopcohort',['Measure','All evaluated players','Selected high-scoring players'],[
 ['Player-gameweek observations',f'{len(d):,}',tc['n']],['Zero-point outcomes',f'{100*allc["zero_points_n"]/allc["n"]:.1f}%',f'{100*tc["zero_points_n"]/tc["n"]:.1f}%'],
 *[[label,f'{allc[key]:.3f}',f'{tc[key]:.3f}'] for label,key in [('Risk-adjusted points MAE','overall_mae'),('Risk-adjusted points baseline MAE','baseline_mae'),('Conditional points MAE','conditional_mae'),('Conditional baseline MAE','conditional_baseline_mae')]],['Predictions within two points',f'{allc["within2_pct"]:.1f}%',f'{tc["within2_pct"]:.1f}%']])
 wins=int((players.overall_mae<players.baseline_mae).sum());gain=100*(1-tc['overall_mae']/tc['baseline_mae']);cgain=100*(1-tc['conditional_mae']/tc['conditional_baseline_mae'])
 para('The results show that predicting high-scoring',f'The results show that predicting high-scoring players was considerably harder than the full-population MAE suggested. Their average absolute error was **{tc["overall_mae"]:.3f} points**, and only **{tc["within2_pct"]:.1f}%** of predictions were within two points of the actual outcome.')
 para('However, the model still improved',f'However, the model still improved on the five-round baseline, whose MAE was **{tc["baseline_mae"]:.3f} points**. This corresponds to a **{gain:.2f}% reduction in error**. Conditional points MAE also improved, falling from **{tc["conditional_baseline_mae"]:.3f} to {tc["conditional_mae"]:.3f}**, a reduction of **{cgain:.2f}%**. At the individual-player level, the model achieved lower risk-adjusted MAE than the baseline for **{wins} of the 45 players**.')
 names={'GK':'Goalkeepers','DEF':'Defenders','MID':'Midfielders','FWD':'Forwards'}
 tab('mltoppositions',['Position','Risk-adjusted MAE','Baseline MAE','Reduction','Conditional MAE','Conditional baseline'],[[names[x.position],f'{x.overall_mae:.3f}',f'{x.baseline_mae:.3f}',f'{100*(1-x.overall_mae/x.baseline_mae):.2f}%',f'{x.conditional_mae:.3f}',f'{x.conditional_baseline_mae:.3f}'] for x in positions.itertuples()])
 f=positions[positions.position.eq('FWD')].iloc[0]
 para('Forwards had the highest',f'Forwards had the highest risk-adjusted MAE, at **{f.overall_mae:.3f} points**, and the highest conditional MAE, at **{f.conditional_mae:.3f} points**. This indicates that their returns were particularly difficult to predict in this selected group and evaluation period. It does not establish that forwards are always harder to predict across other seasons or player populations.')
 para('The enriched configuration also did not', 'In this expanded selected-player evaluation, the enriched configuration also had lower risk-adjusted and conditional MAE than the reduced configuration in all four positions. These are group averages; they do not mean that every individual player or gameweek benefited equally from the additional features.')
 fern=players[players.full_name.str.contains('Bruno.*Fernandes',case=False,regex=True)].iloc[0];haaland=players[players.name.eq('Haaland')].iloc[0]
 para('Bruno Fernandes provides',f'Bruno Fernandes provides an example of a clear improvement over the baseline. His risk-adjusted points MAE was approximately **{fern.overall_mae:.3f}**, compared with **{fern.baseline_mae:.3f}** for the baseline. His actual total across the 18 gameweeks was **{fern.actual_total:.0f} points**, while the model\'s successive predictions summed to approximately **{fern.predicted_total:.1f} points**.')
 para('Haaland shows the opposite',f'Haaland shows the opposite result. His risk-adjusted MAE was approximately **{haaland.overall_mae:.3f}**, compared with **{haaland.baseline_mae:.3f}** for the baseline. Across the evaluation period, he scored **{haaland.actual_total:.0f} points**, while the model\'s predictions summed to approximately **{haaland.predicted_total:.1f}**.')
 para('Across all 45 players,',f'Across all 45 players, actual points totalled **{tc["actual_total"]:,.0f}**. The model\'s predictions summed to **{tc["predicted_total"]:,.1f}**, while the baseline predictions summed to **{tc["baseline_total"]:,.1f}**.')
 para('At the same time, the results show',f'At the same time, the results show that the model adds value compared with the chosen historical baselines. It reduced risk-adjusted error by approximately **{gain:.1f}%**, improved the positional averages in all four groups, and outperformed the risk-adjusted-points baseline for **{wins} of 45 players**.')
 pos=pd.read_csv(A/'by_position.csv').set_index('position')
 para('The enriched configuration improved on the points baseline', 'The enriched configuration improved on the points baseline in every position: '+', '.join(f'{names[k].lower()} **{pos.loc[k,"points_mae"]:.3f} versus {pos.loc[k,"points_baseline_mae"]:.3f}**' for k in ['GK','DEF','MID','FWD'])+'.')
 minute=pd.read_csv(A/'by_actual_minutes_group.csv');over=minute[minute.actual_minutes_group.eq('>90')].iloc[0]
 tab('mlminutesgroups',['Recorded minutes','Observations','Enriched risk-adjusted MAE','Baseline points MAE'],[[str(x.actual_minutes_group).replace('>90','More than 90'),f'{x.n:,}',f'{x.points_mae:.3f}',f'{x.points_baseline_mae:.3f}'] for x in minute.itertuples()])
 para('The **82 observations',f'The **{int(over.n)} observations above 90 minutes** were particularly difficult. Their minutes MAE was approximately **{over.minutes_mae:.2f} minutes**. Although predictions were not capped at 90 minutes, the model lacked explicit upcoming fixture-count information. Removing a prediction cap alone was therefore insufficient to handle these cases well. Above-90-minute observations identify only some multiple-fixture gameweeks, not all of them.')
 tab('mlcalibration',['Metric','Baseline','Reduced','Enriched'],[[label]+[f'{p[k][key]:.5f}' for k in ['baseline','reduced','enriched']] for label,key in [('Brier score','brier'),('ROC-AUC','auc'),('Ten-bin calibration gap','ece_10_bins')]])
 para('The enriched configuration achieved the highest pooled',f'The enriched configuration achieved the highest pooled ROC-AUC, at **{p["enriched"]["auc"]:.4f}**. It also achieved a lower Brier score than both alternatives. Together, these results indicate improved participation ranking and lower average squared probability error. Calibration provides a different view.')
 para('The calibration gap was calculated',f'The calibration gap was calculated as the observation-weighted absolute difference between mean predicted probability and observed frequency in ten fixed bins of width 0.1. Empty bins carry zero weight. The enriched configuration had a calibration gap of **{p["enriched"]["ece_10_bins"]:.5f}**, slightly higher than the reduced configuration\'s **{p["reduced"]["ece_10_bins"]:.5f}**. Thus, improved Brier score and ROC-AUC did not mean that every calibration measure improved.')
 para("In the enriched model's highest",f'In the enriched model\'s highest probability bin, the average prediction was **{100*high.predicted:.2f}%**, while the observed participation rate was **{100*high.observed:.2f}%**, across **{int(high.n):,} observations**. The model was therefore somewhat overconfident in this range. The calibration gap depends on the selected bins and evaluation population. It is a descriptive measure, rather than evidence that probabilities are equally reliable for every player or situation. No recalibration was fitted on the evaluation folds.')
 groups={'full':'None: full enriched','recent_points':'Recent points','recent_minutes':'Recent minutes','ict':'ICT statistics','season_history':'Season history','market':'Market information','availability':'Availability','api_form':'API form','position':'Position','team_strength':'Team strength'}
 tab('mlablation',['Removed group','Conditional MAE','Risk-adjusted MAE','Brier','Minutes MAE'],[[label]+[f'{S[(S.configuration.eq("full" if key=="full" else "without_"+key)) & S.task.eq(task)].iloc[0].mean_gameweek_loss:.5f}' for task in ['conditional_points','overall_points','participation','minutes']] for key,label in groups.items()])
 av=ab[ab.removed_group.eq('availability')].set_index('task')
 para('**Availability information made',f'**Availability information made the clearest contribution.** Removing it increased risk-adjusted points MAE by **{av.loc["overall_points","mean_difference"]:.5f}**, participation Brier score by **{av.loc["participation","mean_difference"]:.5f}**, and minutes MAE by **{av.loc["minutes","mean_difference"]:.5f}**. All three differences remained above zero after the multiple-comparison adjustment.')
 # Summarise supported contributions from the actual updated adjusted bounds.
 helpful=ab[ab.family_low.gt(0) & ~ab.removed_group.eq('availability')]
 labels={'conditional_points':'conditional points','overall_points':'risk-adjusted points','participation':'participation','minutes':'minutes'}
 clauses=[groups[key]+' helped '+', '.join(labels[t] for t in z.task) for key,z in helpful.groupby('removed_group',sort=False)]
 para('Market information also contributed', '; '.join(clauses)+'. These statements refer to the primary adjusted intervals and the evaluated period.')
 para('The additional contributions of ICT statistics', 'The additional contributions of API form and team strength were less clear after adjustment. ICT statistics helped risk-adjusted points, but their contribution to the other tasks remained uncertain. Related features can contain overlapping information, allowing the remaining groups to compensate when one group is removed.')
 blabel={'baseline_conditional':'Qualifying-appearance mean','baseline_points':'Five-round points mean','baseline_played':'Five-round frequency','baseline_minutes':'Five-round minutes mean','baseline_minutes_last':'Previous-round minutes'}
 tasklabel={'conditional_points':'Conditional points MAE','overall_points':'Risk-adjusted points MAE','participation':'Participation Brier','minutes':'Minutes MAE'}
 def interval(x):return f'[{x.family_low:+.5f}, {x.family_high:+.5f}]'
 tab('mlbaselineintervals',['Metric','Baseline','Difference','Adjusted interval'],[[tasklabel[x.task],blabel[x.comparator],f'{x.mean_difference:+.5f}',interval(x)] for x in U[~U.comparator.eq('reduced_matched')].itertuples()])
 tab('mlreducedintervals',['Metric','Difference','Adjusted interval'],[[tasklabel[x.task],f'{x.mean_difference:+.5f}',interval(x)] for x in U[U.comparator.eq('reduced_matched')].itertuples()])
 # Existing file paths and cross-reference IDs are retained.
 for name in ['01_points_mae.png','02_mean_points.png','03_minutes_mae.png','04_calibration.png','05_scatter.png','06_errors.png','07_position.png','09_coverage.png','10_auc.png']:shutil.copy2(A/name,FIG/name)
 shutil.copy2(T/'position_summary.png',FIG/'top_players_position_summary.png')
 shutil.copy2(T/fern.graph,FIG/'top_players_fernandes.png');shutil.copy2(T/haaland.graph,FIG/'top_players_haaland.png')
 # Chapter captions specify family-adjusted intervals, so render those bounds.
 fig,axes=plt.subplots(2,2,figsize=(12,9))
 for ax,task in zip(axes.flat,tasklabel):
  z=ab[ab.task.eq(task)].reset_index(drop=True)
  for i,x in z.iterrows():ax.plot([x.family_low,x.family_high],[i,i],color='steelblue');ax.plot(x.mean_difference,i,'o',color='steelblue')
  ax.set_yticks(range(len(z)),z.removed_group);ax.axvline(0,color='grey',ls='--');ax.set_title(tasklabel[task]);ax.set_xlabel('Removed minus full loss — adjusted interval')
 fig.tight_layout();fig.savefig(FIG/'11_ablation_intervals.png',dpi=170);plt.close(fig)
 z=U[~U.comparator.eq('reduced_matched')].reset_index(drop=True);fig,ax=plt.subplots(figsize=(9,5))
 for i,x in z.iterrows():ax.plot([x.family_low,x.family_high],[i,i],color='steelblue');ax.plot(x.mean_difference,i,'o',color='steelblue')
 ax.set_yticks(range(len(z)),[tasklabel[x.task]+' / '+blabel[x.comparator] for x in z.itertuples()]);ax.axvline(0,color='grey',ls='--');ax.set_xlabel('Model loss minus baseline loss — adjusted interval');fig.tight_layout();fig.savefig(FIG/'12_baseline_intervals.png',dpi=170);plt.close(fig)
 fig,ax=plt.subplots(figsize=(11,3));ax.set(xlim=(0,11),ylim=(0,3));ax.axis('off')
 for x,title,body in [(0.1,'Train on earlier rounds','Eligible targets from GW6\nthrough the round before prediction'),(3.9,'Predict one target round','Use pre-deadline metadata\nand previous player outcomes'),(7.7,'Compare with actual outcomes','Repeat for GW21–38\n18 rounds, 14,476 observations')]:
  ax.add_patch(FancyBboxPatch((x,.5),3.15,1.8,boxstyle='round,pad=0.1',facecolor='#edf4fb',edgecolor='#2378b8'));ax.text(x+1.575,1.85,title,ha='center',fontsize=10,weight='bold');ax.text(x+1.575,1.2,body,ha='center',va='center',fontsize=9)
 for x in [3.35,7.15]:ax.annotate('',xy=(x+.4,1.4),xytext=(x,1.4),arrowprops={'arrowstyle':'->'})
 fig.tight_layout();fig.savefig(FIG/'00_procedure.png',dpi=170,bbox_inches='tight');plt.close(fig)
 updated=ui+'## Machine-Learning Evaluation'+ml
 CH.write_text(updated,encoding='utf-8')
 assert CH.read_text(encoding='utf-8').split('## Machine-Learning Evaluation',1)[0]==ui
 assert not re.search(r'21-35|gameweek 35|15 gameweeks|11,996|7,697|495 model fits',ml)
 refs=re.findall(r'!\[[^\]]*\]\(([^)]+)\)',ml)
 assert all((Path('Thesis')/p).exists() for p in refs)
 (ROOT/'chapter-update-verification.json').write_text(json.dumps({'ui_unchanged':True,'section':'8.2','period':'GW21-38','figure_references':len(refs),'all_figures_exist':True,'pdf_rebuilt':False,'chapter_sha256':hashlib.sha256(CH.read_bytes()).hexdigest(),'top_players':45,'top_player_rows':810},indent=2))
 print('Updated Chapter 8.2 and',len(refs),'referenced figures; no PDF build.')

if __name__=='__main__':main()
