"""Show all observations in the extended recommendation evaluation."""
from pathlib import Path
import json, hashlib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/evaluation-recommendations-gw21-38'
FIG=OUT/'figures';FIG.mkdir(exist_ok=True)
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
def save(fig,name):
    fig.tight_layout();fig.savefig(FIG/name,dpi=180);plt.close(fig)
source=(Path(__file__).parent/'refresh_recommendation_figures.py').read_text(encoding='utf-8')
source=source[source.index('week=pd.read_csv'):source.index("(OUT/'summary.json')")]
for n in [6,8,9]:
    source=source.replace(f'output/evaluation-day{n}',f'output/evaluation-recommendations-gw21-38/day{n}')
source=source.replace('len(z)==15','len(z)==18').replace('len(z)==300','len(z)==360').replace('300 cases','360 cases').replace('len(z)==11','len(z)==14').replace('11 starts','14 starts')
exec(compile(source,'<extended-recommendation-figures>','exec'))
r=pd.read_csv(OUT/'day8/returns.csv')
fig,ax=plt.subplots(figsize=(10,4))
for p,label in [('personalised','Personalised'),('xpts','Risk-adjusted points'),('form','Recent form')]:
    z=r[(r.policy==p)&(r.horizon==5)]
    ax.plot(z.gameweek,z.actual_points,'o-',label=label)
ax.set(xlabel='Starting gameweek',ylabel='Actual points over five gameweeks',title='All 14 starting weeks, GW21–34; outcomes through GW38')
ax.legend();save(fig,'07_five_week_returns.png')
print('Seven figures saved',flush=True)
