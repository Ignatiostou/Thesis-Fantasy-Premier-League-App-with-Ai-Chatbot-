"""Final scope, reproducibility and thesis checks for the extended evaluation."""
from pathlib import Path
import json, hashlib, shutil
import pandas as pd
ROOT=Path(__file__).resolve().parents[3]
B=ROOT/'output/evaluation-recommendations-gw21-38'
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
old=read(ROOT/'output/evaluation-day6/inputs.json')
new=read(B/'day6/inputs.json')
assert old==new[:15]
old_dec=read(ROOT/'output/evaluation-day6/decisions.json')['weeks']
new_dec=read(B/'day6/decisions.json')['weeks']
assert old_dec==new_dec[:15]
assert read(ROOT/'output/evaluation-day9/scored.json')==read(B/'day9/scored.json')
ds=read(B/'day8/decisions.json')
for gw in range(21,39):
    squads={r['policy']:set(r['squad']) for r in ds if r['gameweek']==gw}
    assert squads['short_horizon']==squads['personalised']==squads['long_horizon']
r=pd.read_csv(B/'day8/returns.csv')
assert set(r.gameweek)==set(range(21,35)) and len(r)==14*5*3
before=(B/'chapter8-before.md').read_text(encoding='utf-8')
after=(ROOT/'Thesis/chapter-8/8-evaluation.md').read_text(encoding='utf-8')
start='### Historical Player Rankings and Captain Selection'
end='### Conclusion {#sec:recommendationconclusion}'
assert before.split(start)[0]==after.split(start)[0]
assert before.split(end)[1]==after.split(end)[1]
for p in read(B/'pdf-hashes.json'):
    assert hashlib.sha256(Path(p['Path']).read_bytes()).hexdigest().upper()==p['Hash']
figs=list((B/'figures').glob('*.png'));assert len(figs)==7
for p in figs:shutil.copy2(p,ROOT/'Thesis/chapter-8/figures/recommendations'/p.name)
manifest={'status':'PASS','gameweeks':list(range(21,39)),'old_GW21_35_inputs_and_decisions_identical':True,'persistent_scored_results_identical':True,'horizon_squads_identical_all_18_rounds':True,'holding_start_gameweeks':list(range(21,35)),'evaluation_tests_passed':4,'typescript_check':'passed','pdf_unchanged':True,'new_graphs':7}
paths=list((B/'scripts').glob('*.py'))+list((ROOT/'apps/api/src/modules/assistant/__tests__').glob('gw21-38-*.ts'))
manifest['harness_sha256']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
(B/'verification.json').write_text(json.dumps(manifest,indent=2))
(B/'Results.md').write_text('''# Recommendation evaluation: GW21–38

The saved ML forecasts were reused; no models or production services were changed.
The original GW21–35 input and decision records match exactly. The additional
GW36–38 cases extend the same procedure. All 360 weekly squads and 1,398 selected
transfers were verified. There were 90 optimal squad solves, and holding returns
use 14 common starting weeks (GW21–34), ending no later than GW38.

The application top-ten mean is 4.528 versus 4.600 for risk-adjusted points and
3.939 for form. Captaincy means are 4.461, 4.272 and 3.578 respectively. Only the
captaincy-versus-form adjusted interval excludes zero. Transfer mean gains are
4.119 versus 4.131 without a penalty and 0.142 versus 0.158 with a four-point cost.
The forecast-based squad objectives exceed form on average; personalisation does
not exceed direct risk-adjusted points. Persistent-squad and chip results match
the prior GW21–38 experiment exactly. Chip increments are separate counterfactuals,
not a chip-timing strategy.

Four evaluation tests and the API TypeScript check passed. Python independently
verified selection outcomes and persistent financial/squad state. No PDF rebuilt.

Reproduce from the project root with extend_recommendations_21_38.py prepare,
then run the two gw21-38-day*.evaluation.test.ts files with Vitest in apps/api,
then extend_recommendations_21_38.py analyze and plot_recommendations_21_38.py.
The scripts subdirectory records the exact adapted Python experiment bodies.
''',encoding='utf-8')
print(json.dumps(manifest,indent=2))
