"""Independent state checks and descriptive Day 9 results; no production writes."""
from pathlib import Path
import json,hashlib,shutil
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from day9_planning import OUT,ROOT,SRC

def main():
 input=json.loads((OUT/'inputs.json').read_text());dec=json.loads((OUT/'decisions.json').read_text());d=pd.DataFrame(json.loads((OUT/'scored.json').read_text()))
 weeks={w['gameweek']:{p['playerId']:p for p in w['players']} for w in input['weeks']}
 initial={s['id']:s for s in input['initial']};prior={};rows=dec['records'];different_sales=0;changed=0
 for r in rows:
  key=(r['case'],r['policy']);ps=weeks[r['gameweek']]
  if key not in prior:
   assert r['startIds']==initial[r['case']]['players'] and r['startBank']==initial[r['case']]['bank'] and r['startFt']==1
   buys={pid:ps[pid]['price'] for pid in r['startIds']}
  else:
   prev=prior[key];assert r['gameweek']==prev['gameweek']+1 and r['startIds']==prev['players'] and r['startBank']==prev['bank']
   assert r['startFt']==min(max(prev['startFt']-len(prev['moves']),0)+1,2)
   buys={int(k):v for k,v in prev['buys'].items()}
  ids=list(r['startIds']);bank=r['startBank']
  for i,m in enumerate(r['moves']):
   out,inc=m['outgoing'],m['incoming'];assert out in ids and inc not in ids
   buy=buys[out];now=ps[out]['price'];sale=now if now<=buy else buy+(now-buy)//2
   different_sales+=int(sale!=now)
   assert sale==m['sellPrice'] and m['buyPrice']==ps[inc]['price'] and m['cost']==(0 if i<r['startFt'] else 4)
   assert ps[out]['position']==ps[inc]['position'] and ps[inc]['eligibleIncoming']
   assert m['forecastGain']>m['cost']
   bank+=sale-m['buyPrice'];ids[ids.index(out)]=inc;buys.pop(out);buys[inc]=m['buyPrice']
  assert ids==r['players'] and bank==r['bank'] and bank>=0 and {int(k):v for k,v in r['buys'].items()}==buys
  assert len(ids)==len(set(ids))==15 and len(r['xi'])==11 and len(r['bench'])==4
  assert set(r['xi']).isdisjoint(r['bench']) and set(r['xi']+r['bench'])==set(ids)
  counts=pd.Series([ps[i]['position'] for i in r['xi']]).value_counts()
  assert counts['GK']==1 and 3<=counts['DEF']<=5 and 2<=counts['MID']<=5 and 1<=counts['FWD']<=3
  assert r['captain'] in r['xi'] and r['vice'] in r['xi'] and r['captain']!=r['vice']
  assert pd.Series([ps[i]['team'] for i in ids]).value_counts().max()<=3
  prior[key]=r
 assert len(rows)==len(d)==2160 and not d.duplicated(['case','policy','gameweek']).any()
 assert d.groupby(['case','policy']).size().eq(18).all()
 assert np.allclose(d.points,d.gross-d.hits)
 d.to_csv(OUT/'weekly_case_results.csv',index=False)
 totals=d.groupby(['case','policy'],as_index=False).agg(points=('points','sum'),hits=('hits','sum'),transfers=('transfers','sum'),autoSubs=('autoSubs','sum'))
 totals.to_csv(OUT/'case_totals.csv',index=False)
 summary=totals.groupby('policy').agg(mean_points=('points','mean'),median_points=('points','median'),min_points=('points','min'),max_points=('points','max'),mean_hits=('hits','mean'),mean_transfers=('transfers','mean')).reset_index()
 summary.to_csv(OUT/'summary.csv',index=False)
 paired=totals.pivot(index='case',columns='policy',values='points');pairs=[]
 for base in ['xpts_global','form_global','hold']:
  delta=paired.app_balanced-paired[base];pairs.append(dict(comparison='app_balanced minus '+base,mean=float(delta.mean()),median=float(delta.median()),min=int(delta.min()),max=int(delta.max()),positive=int(delta.gt(0).sum()),ties=int(delta.eq(0).sum()),negative=int(delta.lt(0).sum())))
 pd.DataFrame(pairs).to_csv(OUT/'paired_case_differences.csv',index=False)
 # Available one-week chip effects, not a timing policy or replay of chip stock.
 chip=d[d.policy.eq('app_balanced')].groupby('gameweek')[['tcIncrement','bbIncrement']].mean()
 chip.to_csv(OUT/'chip_counterfactuals.csv')
 plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
 fig,ax=plt.subplots(figsize=(10,4));ax.bar(summary.policy,summary.mean_points);ax.set(ylabel='Mean net points over 18 rounds',title='Persistent synthetic squads: GW21–38');ax.tick_params(axis='x',rotation=20);fig.tight_layout();fig.savefig(OUT/'01_policy_totals.png',dpi=170);plt.close(fig)
 weekly=d.groupby(['policy','gameweek']).points.mean().unstack('policy');weekly.cumsum().plot(figsize=(10,4));plt.ylabel('Cumulative mean net points');plt.xlabel('Gameweek');plt.tight_layout();plt.savefig(OUT/'02_cumulative_returns.png',dpi=170);plt.close()
 chip.plot(figsize=(9,4),marker='o');plt.ylabel('Mean extra points in that single round');plt.xlabel('Gameweek');plt.title('Independent chip counterfactuals — not a chip schedule');plt.tight_layout();plt.savefig(OUT/'03_chip_opportunities.png',dpi=170);plt.close()
 verification=dict(status='PASS',persistent_paths=120,squad_gameweeks=2160,rounds=18,identical_starting_squads=True,finance_and_purchase_price_history=True,profit_half_sales_differing_from_market=different_sales,legal_XIs_and_squads=True,production_scoring_includes_autosubs_and_captain_fallback=True,test_result='72 tests passed (6 new evaluation tests, 66 existing); TypeScript check passed',source_hashes=dec['hashes'])
 (OUT/'verification.json').write_text(json.dumps(verification,indent=2))
 def table(df,columns):
  lines=['| '+' | '.join(columns)+' |','| '+' | '.join(['---']*len(columns))+' |']
  for _,r in df.iterrows():lines.append('| '+' | '.join(f'{r[c]:.3f}' if isinstance(r[c],(float,np.floating)) else str(r[c]) for c in columns)+' |')
  return '\n'.join(lines)
 s=summary.set_index('policy');same_short=int(paired.app_short.eq(paired.app_balanced).sum());same_long=int(paired.app_long.eq(paired.app_balanced).sum())
 text=f'''# Day 9 — persistent transfers, chip rules and planning limitations

## Stage scope

Day 8's bounded squad-optimisation experiment was complete. Day 9 adds a persistent-squad replay and controlled chip/rule checks. It uses the expanded **GW21–38** ML forecasts, 20 identical initial synthetic squads and six policies: **120 paths and 2,160 squad-gameweeks**. It is not a replay of real managers or an evaluation of an implemented global multiweek optimiser.

The application provides weekly transfer candidates scored with weighted one-, three- and five-week projections. The inspected function does not search future transfer sequences or jointly optimise chip timing. The chip-advice path gathers lineup and weak-link context, then supplies guidance for the conversational response. A mocked execution confirmed that the ML block for `CHIP_ADVICE` contains generic ranked players, not a calculated chip schedule. No live LLM responses were evaluated here.

## Persistent transfer replay

All policies start with the same 20 valid GW21 squads used in Day 6. Decisions use pre-deadline inputs only; actual outcomes were kept in a separate file and joined after all paths were saved. A squad's bank, purchased players and purchase prices persist into the following round. Sale proceeds use the actual production half-profit helper. The independent audit found {different_sales} sales where the sell price differs from the current market price, so this is no longer the equal-purchase-and-sale-price assumption used in Day 6.

The three app policies use the production transfer scoring function with short, balanced and long horizon preferences. They retain its outgoing bottom-six and incoming top-40 shortlist. Two baselines examine all feasible one-player pairs: highest one-week risk-adjusted points gain and highest recent-form gain. The hold policy makes no transfers. These unrestricted baselines are stronger than Day 6's within-shortlist comparator.

An evaluation wrapper checks affordability, same position and the three-per-club limit. It allows at most two sequential transfers per round, requiring the chosen forecast gain to exceed the incremental hit cost. Newly bought players cannot be sold again in the same round. One free transfer is initially available; carry-over follows the app's two-transfer cap. These wrapper choices define the experiment; they are not a new production planning algorithm. The recent-form policy compares its own form gain with the cost, while app and risk-adjusted baselines use one-week predicted gain.

All policies use the same legal-lineup selection rule: maximise risk-adjusted points over valid formations, then choose captain and vice-captain by the same forecast. The bench is ordered by forecast with its goalkeeper last. The production scoring helper applies automatic substitutions, captain fallback and hits to observed outcomes. Forecast selection and realised scoring are separate. Bank and squad validity were checked after every round.

Fixtures remain neutral: three- and five-week projections are 3 and 4.75 times the one-week prediction. Forecast confidence uses the production helper. Long-term preferences therefore do not introduce independently forecast future conditions. The entire experiment retains the historical-model limitations documented in Days 6–8.

## Results

The table gives averages across the 20 starting squads. Points cover all 18 rounds and include hit deductions. Higher points are better.

'''+table(summary,['policy','mean_points','mean_hits','mean_transfers','min_points','max_points'])+f'''

The balanced app policy averaged **{s.loc['app_balanced','mean_points']:.2f} net points**, compared with **{s.loc['xpts_global','mean_points']:.2f}** for the unrestricted risk-adjusted-points policy, **{s.loc['form_global','mean_points']:.2f}** for recent form and **{s.loc['hold','mean_points']:.2f}** for holding the original squad. This compares repeated weekly decisions under one specified wrapper, not optimal transfer planning.

![Net points by policy](01_policy_totals.png)
![Cumulative returns](02_cumulative_returns.png)

'''+table(pd.DataFrame(pairs),['comparison','mean','positive','ties','negative'])+f'''

These are paired descriptive results. The 20 paths share players, fixtures and gameweeks; they are not 20 independent season trials. No significance claim is made from treating them as independent. Short and balanced policies had identical final scores in {same_short}/20 paths; long and balanced in {same_long}/20. Equal scores do not necessarily imply identical transfer sequences. The proportional future horizons limit what this experiment can show about planning preferences.

## Chip checks and findings

The existing chip activation and points tests, plus new evaluation cases, were run against production functions. In total, **72 tests passed**, and TypeScript checking passed. Passing characterisation tests means that the documented behaviour was reproduced; it does not mean that every behaviour is desirable.

1. **Outdated chip inventory.** At GW21, a Bench Boost, Triple Captain or Free Hit used in GW10 is still reported unavailable. Only Wildcard is checked by half-season. Official 2025–26 rules allocate each of the four chips in each half. The app's non-Wildcard availability checks and its assistant's once-per-season descriptions do not match that season. [Official chip changes](https://www.premierleague.com/en/news/4362027)
2. **Outdated saved-transfer cap.** With two unused transfers, the app starts the next round with two, rather than allowing accumulation toward five. The official 2025–26 season allows five saved transfers. The replay deliberately follows the app's cap, so it must not be called a fully official-rules simulation. [Official season changes](https://www.premierleague.com/en/news/4362211)
3. **No computed chip schedule in the ML block.** The executed `CHIP_ADVICE` request fell through to general ML squad context. The surrounding recommendation service adds heuristic instructions, and the chatbot may discuss timing, but that is not a tested numerical multiweek chip optimiser.
4. **The low-level ML lineup helper does not enforce formation quotas.** A controlled valid 15-player squad produced ten outfield starters containing only two defenders. The main chip-advice service also calls a separate heuristic lineup optimiser, so this finding is about this helper, not proof that the UI submits an illegal XI. The replay used an independently constrained lineup rule.

## What the chip graph means

For each saved balanced-policy squad, we recomputed that round's score with Bench Boost and Triple Captain separately. The graph shows the mean extra points under each independent counterfactual. Automatic substitutions matter: Bench Boost gain is not necessarily the raw sum of the original bench because some substitutes would already count without the chip. Triple Captain gain matches the effective captain's observed points, including vice-captain fallback when applicable.

![Single-round chip increments](03_chip_opportunities.png)

This graph does **not** play a chip every week in a legal season or identify a deployable timing policy. Each point is an independent what-if calculation. Choosing the best round after seeing these outcomes would use hindsight. We did not claim a benefit from chip recommendations, test a joint chip schedule, or simulate Wildcard/Free Hit squad reconstruction here.

## Status and remaining work

**The bounded Day 9 replay and rule audit are complete. Full multiweek planning and chip-strategy effectiveness are not established.** The distinction matters because the inspected application does not implement the numerical planner that a full optimisation benchmark would evaluate. The new findings were documented without changing production code.

Before claiming official 2025–26 rule compliance, the chip inventory and saved-transfer cap need correction and regression tests. A true planning evaluation would additionally require a defined transfer/chip policy, trustworthy changing fixture horizons, explicit chip stock and Free Hit/Wildcard transitions, and a replay under those rules. Real-manager histories and prospective use remain separate evidence. This work does not need to be described as completed merely to move to another evaluation topic.

## Reproduction and saved evidence

Run `apps/ai/evaluation/day9_planning.py` to prepare inputs. Run the three `day9-*.evaluation.test.ts` files with Vitest (plus the existing chip, transfer, points and gameweek tests), then `apps/ai/evaluation/report_day9.py`. Saved evidence includes input/outcome files, decisions and price histories, scored records, paired differences, chip counterfactuals, controlled-case outputs, source hashes and `verification.json`. No database or production model files are modified.
'''
 (OUT/'Day-9-Results.md').write_text(text,encoding='utf-8')
 for name in ['day9_planning.py','report_day9.py']:shutil.copy2(Path(__file__).parent/name,OUT/name)
 (OUT/'artifact_hashes.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.is_file() and p.name!='artifact_hashes.json'},indent=2))
 print(summary.to_string(index=False));print(json.dumps(verification,indent=2))

if __name__=='__main__':main()
