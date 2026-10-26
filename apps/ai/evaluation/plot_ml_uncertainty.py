from pathlib import Path
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
p=Path('output/evaluation-ml-statistics');d=pd.read_csv(p/'baseline_uncertainty.csv');d=d[d.block_length==3]
fig,axs=plt.subplots(1,3,figsize=(12,4))
for ax,rows,title in [(axs[0],d[d.task.isin(['conditional_points','overall_points'])],'Points MAE difference'),(axs[1],d[d.task=='participation'],'Participation Brier difference'),(axs[2],d[d.task=='minutes'],'Minutes MAE difference')]:
 labels=[('Conditional' if r.task=='conditional_points' else 'Overall' if r.task=='overall_points' else 'Participation' if r.task=='participation' else 'vs last round' if r.baseline.endswith('last') else 'vs five-round mean') for r in rows.itertuples()]
 for i,r in enumerate(rows.itertuples()):ax.errorbar(r.mean_difference,i,xerr=[[r.mean_difference-r.ci95_low],[r.ci95_high-r.mean_difference]],fmt='o',capsize=4)
 ax.axvline(0,color='grey',ls='--');ax.set_yticks(range(len(labels)),labels);ax.set_title(title);ax.set_xlabel('Model minus baseline');ax.set_ylim(-.7,len(labels)-.3)
fig.suptitle('Paired gameweek differences | approximate marginal 95% block-bootstrap intervals');fig.tight_layout();fig.savefig(p/'baseline_intervals.png',dpi=180)
