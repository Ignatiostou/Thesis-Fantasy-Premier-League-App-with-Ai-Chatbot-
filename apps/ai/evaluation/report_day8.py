from pathlib import Path
import json
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'output/evaluation-day8'
r=pd.read_csv(OUT/'returns.csv');v=json.loads((OUT/'verification.json').read_text());decisions=json.loads((OUT/'decisions.json').read_text())
means=r.groupby(['horizon','policy']).actual_points.mean().unstack();means.to_csv(OUT/'summary.csv')
same=0
for gw in range(21,36):
    sets={d['policy']:set(d['squad']) for d in decisions if d['gameweek']==gw}
    same+=sets['short_horizon']==sets['personalised']==sets['long_horizon']
assert same==15
fig,ax=plt.subplots(figsize=(9,4.7))
for j,(p,label) in enumerate([('personalised','Personalised objective'),('xpts','Predicted-points objective'),('form','Recent-form objective')]):
    ax.bar([i+(j-1)*.24 for i in range(3)],means[p].to_numpy(),.23,label=label)
ax.set(xticks=[0,1,2],xticklabels=['1 gameweek','3 gameweeks','5 gameweeks'],ylabel='Mean actual XI points including captain bonus',title='Fixed squad, XI and captain: GW21–31 starting weeks')
ax.legend();fig.tight_layout();fig.savefig(OUT/'01_squad_returns.png',dpi=180);plt.close(fig)
fig,ax=plt.subplots(figsize=(9,4.7))
for p,label in [('personalised','Personalised'),('xpts','Predicted points'),('form','Recent form')]:
    x=r[(r.policy==p)&(r.horizon==5)];ax.plot(x.gameweek,x.actual_points,marker='o',label=label)
ax.set(xlabel='Starting gameweek',ylabel='Actual points over the next five gameweeks',title='Overlapping five-gameweek holding periods');ax.legend();fig.tight_layout();fig.savefig(OUT/'02_five_week_returns.png',dpi=180);plt.close(fig)
table='\n'.join(f"| {h} | {row.personalised:.3f} | {row.xpts:.3f} | {row.form:.3f} |" for h,row in means.iterrows())
report=f'''# Day 8 — squad optimisation and fixed multiweek holding

## What was evaluated

We executed the production Python integer-programming optimiser offline, using the same archived candidate pools and enriched forecasts as Day 6. Actual function bodies and constants were loaded without database setup. Historical candidate frames and profiles replaced SQL responses. This tests the solver and its objective, not the live database query or browser integration.

There were five policies for each of 15 gameweeks (GW21–35), giving 75 historical solves: balanced personalisation, short and long planning settings, and two constrained baselines. The baselines used the same solver and constraints but maximised one-week predicted points or preceding five-round form instead of the personalised objective. All started from the same input pools; the production positive-objective filter applies to each objective. These are strong feasible baselines, not randomly chosen or deliberately weak squads.

Every run was independently checked for 15 distinct players, 2 goalkeepers, 5 defenders, 5 midfielders, 3 forwards, cost at most £100m and at most three players per club. All 75 returned OPTIMAL and passed these checks. Median elapsed solve-function time was {v['median_seconds']:.3f} seconds; the maximum was {v['max_seconds']:.3f} seconds on this machine. These timings include dataframe preparation within the function and shortlist generation; they are not end-to-end app latency.

## Solver verification and edge cases

An independent exhaustive enumeration checked all 136 possible 15-player subsets of a 17-player pool. Among the {v['feasible_enumerated_subsets']} feasible subsets, the highest independently calculated objective matched the production solver. This is a small-instance correctness check, not exhaustive verification of every production input.

Seven targeted assertions also covered an empty pool, insufficient budget, valid forced inclusion/exclusion, contradictory constraints, unknown forced-player IDs and a custom budget. Two assertions document shortcomings rather than desirable behaviour:

- An unknown forced-in player ID was ignored and the optimiser still returned a squad. The UI may restrict which IDs reach the optimiser, but the function itself does not reject this request.
- With a £90m budget, the selected squad respected £90m, but `budget_left` was calculated from £100m. The solver constraint is correct; the reported remaining amount is not generalised to the supplied budget.

Both findings were recorded without changing production code. The randomised browsable shortlist is separate from the purchased 15-player squad; its sampling seed was fixed during this experiment.

## Historical return comparison

For each selected squad, a common evaluation rule chose a legal starting XI by maximising the one-week predicted points over legal formations. The highest predicted scorer in that XI became captain. This is an evaluation rule shared by all policies, not an evaluation of the app's lineup-selection service. Squad, XI and captain were then held fixed.

One-, three- and five-gameweek returns used the same 11 starting weeks, GW21–31. The final five-week period ends at GW35. Actual points were joined only after decisions were generated, and missing outcomes caused an error rather than being silently replaced by zero. Totals include the captain's extra points. There were no transfers, vice-captain substitution, automatic substitutions or chips during a holding period. These are deliberately simplified holding scenarios, not official simulated season scores.

| Holding period, gameweeks | Personalised objective | Predicted-points objective | Recent-form objective |
|---|---:|---:|---:|
{table}

![Mean squad returns](01_squad_returns.png)

The personalised squads averaged 56.091 points over one gameweek and 249.273 over five. The predicted-points baseline was slightly higher: 56.455 and 250.455 respectively. Recent-form squads averaged 48.091 and 217.909. The results favour using the model forecasts over recent form in this sample, but do not establish an additional benefit from personalisation.

![Five-week holding returns](02_five_week_returns.png)

The five-week periods overlap and share players and outcomes. They are not 11 independent five-week trials. These results are descriptive; no statistical superiority claim is made. The dataset was already used during development, and the live production feature configuration differs from the historical enriched model.

## Meaning of the planning horizon

Short, balanced and long settings selected the same squads in all 15 rounds under this fixture-neutral adapter. This is understandable: the five-week projection is 4.75 times the one-week forecast. Changing the weights mainly rescales the same information instead of introducing a new forecast of future conditions. With proportional horizons, a different planning preference need not change rankings or selected squads.

This finding must not be generalised to verified non-neutral fixture projections. Day 7's fixture limitations remain unresolved. Team names were neutralised here so the comparison does not introduce unverified Big Six preferences. The historical candidate rule uses available status and prior mean minutes, narrower than the live candidate SQL rule. Also, a stored balanced profile has a different differential coefficient from the no-profile default; this experiment uses the stored balanced profile consistently.

The optimiser maximises a sum over all 15 players. It does not jointly optimise future starting lineups, transfer sequences, purchase/sale prices, chips or captain choices. The held-XI results therefore evaluate what these squads earned under the specified lineup rule; they do not validate a dynamic multiweek planner.

## Stage status

Day 8's bounded squad-optimisation and fixed-holding experiment is complete. Production source hashes, solver checks, all squads/XIs/captains and per-period returns are saved in this directory. The two edge-case findings remain open. No production code was changed.

Dynamic multiweek transfers and chip strategy remain separate work for Day 9. Historical manager replay and prospective evaluation are also still outstanding. Day 7 remains explicitly incomplete for full fixture effects.

## Reproduction

From the repository root run `apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/day8_optimisation.py`, then `apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/report_day8.py`. These commands use PuLP/CBC locally and never call the live database. Independent small-instance enumeration and feasibility assertions execute in the first script.
'''
(OUT/'Day-8-Results.md').write_text(report,encoding='utf-8');print(means.to_string())
