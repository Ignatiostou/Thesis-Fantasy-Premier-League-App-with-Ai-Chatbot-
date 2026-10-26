"""Reproduce recommendation experiments on GW20–38 without replacing old evidence."""
from pathlib import Path
import sys, json, hashlib, types
import pandas as pd
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'output/evaluation-recommendations-gw20-38'
SRC=ROOT/'output/evaluation-enriched-gw21-38'

def transformed(name, replacements, run=True):
    path=Path(__file__).parent/name
    text=path.read_text(encoding='utf-8')
    for a,b in replacements:
        assert a in text, (name,a)
        text=text.replace(a,b)
    # Original narrative reports embed old sample sizes. Keep numerical output
    # and audits only; the new report is written from the refreshed results.
    if name=='day6_recommendations.py':
        start=text.index('    def metric(')
        end=text.index("if __name__=='__main__':",start)
        text=text[:start]+text[end:]
    if name=='report_day9.py':
        start=text.index(' def table(')
        end=text.index("if __name__=='__main__':",start)
        text=text[:start]+" print(summary.to_string(index=False));print(json.dumps(verification,indent=2))\n\n"+text[end:]
    folder=BASE/'scripts';folder.mkdir(parents=True,exist_ok=True)
    (folder/name).write_text(text,encoding='utf-8')
    ns={'__name__':'__main__' if run else name[:-3], '__file__':str(path)}
    exec(compile(text,str(path),'exec'),ns)
    return ns

def common():
    return [(f'output/evaluation-day{n}',f'output/evaluation-recommendations-gw20-38/day{n}') for n in [6,8,9]]

def prepare():
    import temporal_evaluation as ev
    from run_enriched import FEATURES
    BASE.mkdir(exist_ok=True)
    prediction=BASE/'full_predictions.csv'
    if not prediction.exists():
        frame=pd.read_parquet(SRC/'prepared.parquet')
        ev.FEATURES=FEATURES
        added, report=ev.evaluate_fold(frame,'2025-26',20)
        assert report['training_target_gameweeks'][1]<20
        old=pd.read_csv(SRC/'full_predictions.csv')
        full=pd.concat([added,old],ignore_index=True)
        assert set(full.gameweek)==set(range(20,39))
        assert not full.duplicated(['season','player_id','gameweek']).any()
        full.to_csv(prediction,index=False)
        (BASE/'gw20_prediction_report.json').write_text(json.dumps(report,indent=2))
        (BASE/'prediction_provenance.json').write_text(json.dumps({'source_sha256':hashlib.sha256((SRC/'full_predictions.csv').read_bytes()).hexdigest(),'new_fold':20,'reused_gameweeks':list(range(21,39)),'features':FEATURES},indent=2))
    repl=[common()[0],("pd.read_csv(SRC / 'full_predictions.csv')",f"pd.read_csv(Path({str(prediction)!r}))"),("SRC = ROOT / 'output/evaluation-enriched'","SRC = ROOT / 'output/evaluation-enriched-gw21-38'"),('list(range(21,36))','list(range(20,39))')]
    ns=transformed('day6_recommendations.py',repl,False);ns['prepare']()
    repl=[common()[0],common()[2],("pred=pd.read_csv(SRC/'full_predictions.csv')",f"pred=pd.read_csv(Path({str(prediction)!r}))"),('GW21-38','GW20-38'),('GW21 squads','GW20 squads')]
    transformed('day9_planning.py',repl)
    for n,name in [(6,'day6-recommendations.evaluation.test.ts'),(9,'day9-planning.evaluation.test.ts')]:
        p=ROOT/'apps/api/src/modules/assistant/__tests__'/name
        t=p.read_text().replace(f'output/evaluation-day{n}',f'output/evaluation-recommendations-gw20-38/day{n}')
        t=t.replace('toBe(15);expect(squadChecks).toBe(300)','toBe(19);expect(squadChecks).toBe(380)').replace('toBe(2160)','toBe(2280)').replace('},30000)','},120000)').replace('},120000);','},180000);')
        (p.parent/name.replace('day'+str(n),f'gw20-38-day{n}')).write_text(t,encoding='utf-8')

def analyze():
    ns=transformed('day6_recommendations.py',[common()[0]],False);ns['analyze']()
    transformed('verify_day6.py',[common()[0],('len(v)==15','len(v)==19'),('sum(v)/15','sum(v)/19')])
    transformed('day8_optimisation.py',[common()[0],common()[1],("ROOT/'output/evaluation-enriched/full_predictions.csv'",f"Path({str(BASE/'full_predictions.csv')!r})"),('output/evaluation-enriched/input_snapshot.parquet','output/evaluation-enriched-gw21-38/input_snapshot.parquet'),('if gw<=31:','if gw<=34:')])
    # Report function supplies independent replay-state verification.
    module=types.ModuleType('day9_planning');module.OUT=BASE/'day9';module.ROOT=ROOT;module.SRC=SRC
    sys.modules['day9_planning']=module
    transformed('report_day9.py',[('2160','2280'),('.eq(18)','.eq(19)'),('rounds=18','rounds=19'),('18 rounds','19 rounds'),('GW21–38','GW20–38'),("72 tests passed (6 new evaluation tests, 66 existing); TypeScript check passed","GW20–38 replay assertions; test-run evidence stored separately")])
    r=pd.read_csv(BASE/'day8/returns.csv')
    r.groupby(['horizon','policy']).actual_points.mean().unstack().to_csv(BASE/'day8/summary.csv')

if __name__=='__main__':
    {'prepare':prepare,'analyze':analyze}[sys.argv[1]]()
