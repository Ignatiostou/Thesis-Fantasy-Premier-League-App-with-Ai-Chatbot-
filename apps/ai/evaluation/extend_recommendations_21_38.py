"""Extend recommendation evidence using unchanged saved GW21–38 predictions."""
from pathlib import Path
import sys, json, types
import pandas as pd
import extend_recommendations_20_38 as runner
ROOT=runner.ROOT
BASE=ROOT/'output/evaluation-recommendations-gw21-38'
SRC=runner.SRC
runner.BASE=BASE
transform=runner.transformed
replacements=[(f'output/evaluation-day{n}',f'output/evaluation-recommendations-gw21-38/day{n}') for n in [6,8,9]]

def prepare():
    BASE.mkdir(exist_ok=True)
    ns=transform('day6_recommendations.py',[replacements[0],("SRC = ROOT / 'output/evaluation-enriched'","SRC = ROOT / 'output/evaluation-enriched-gw21-38'"),('list(range(21,36))','list(range(21,39))')],False)
    ns['prepare']()
    transform('day9_planning.py',[replacements[0],replacements[2]])
    for n in [6,9]:
        name={6:'day6-recommendations.evaluation.test.ts',9:'day9-planning.evaluation.test.ts'}[n]
        p=ROOT/'apps/api/src/modules/assistant/__tests__'/name
        t=p.read_text().replace(f'output/evaluation-day{n}',f'output/evaluation-recommendations-gw21-38/day{n}')
        t=t.replace('toBe(15);expect(squadChecks).toBe(300)','toBe(18);expect(squadChecks).toBe(360)').replace('},30000);','},180000);').replace('},120000);','},180000);')
        (p.parent/name.replace(f'day{n}',f'gw21-38-day{n}')).write_text(t,encoding='utf-8')

def analyze():
    transform('day6_recommendations.py',[replacements[0]],False)['analyze']()
    transform('verify_day6.py',[replacements[0],('len(v)==15','len(v)==18'),('sum(v)/15','sum(v)/18')])
    transform('day8_optimisation.py',[replacements[0],replacements[1],('output/evaluation-enriched/','output/evaluation-enriched-gw21-38/'),('if gw<=31:','if gw<=34:')])
    module=types.ModuleType('day9_planning');module.OUT=BASE/'day9';module.ROOT=ROOT;module.SRC=SRC
    sys.modules['day9_planning']=module
    transform('report_day9.py',[("72 tests passed (6 new evaluation tests, 66 existing); TypeScript check passed","GW21–38 replay assertions; test-run evidence stored separately")])
    r=pd.read_csv(BASE/'day8/returns.csv')
    r.groupby(['horizon','policy']).actual_points.mean().unstack().to_csv(BASE/'day8/summary.csv')
    print('GW21–38 analysis completed',flush=True)

if __name__=='__main__':
    {'prepare':prepare,'analyze':analyze}[sys.argv[1]]()
