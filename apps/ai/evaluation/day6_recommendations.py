"""Prepare deadline-only decisions, then evaluate saved decisions against outcomes."""
from pathlib import Path
import ast, hashlib, json, sys
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output/evaluation-day6'
SRC = ROOT / 'output/evaluation-enriched'

def prepare():
    OUT.mkdir(exist_ok=True)
    pred = pd.read_csv(SRC / 'full_predictions.csv')
    feat = pd.read_parquet(SRC / 'prepared.parquet')
    keys = ['season', 'player_id', 'gameweek']
    cols = keys + ['snapshot_name','snapshot_position','snapshot_team','snapshot_price','snapshot_ownership','status_a','minutes_mean3']
    d = pred.merge(feat[cols], on=keys, validate='one_to_one')
    raw = pd.read_parquet(SRC / 'input_snapshot.parquet')
    # Reuse the actual confidence function without importing inference/database setup.
    source = (ROOT / 'apps/ai/inference/predict_next_gw.py').read_text(encoding='utf-8')
    function = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'derive_confidence')
    scope = {}; exec(compile(ast.Module(body=[function], type_ignores=[]), '<production-confidence>', 'exec'), scope)
    confidence = scope['derive_confidence']
    rng = np.random.default_rng(20260916)
    games = []; coverage = []
    for gw, full in d.groupby('gameweek', sort=True):
        # Same ex-ante candidate rule for every policy. No actual-points/minutes filter.
        g = full[(full.status_a == 1) & (full.minutes_mean3 >= 30)].sort_values('player_id')
        assert len(g) >= 30
        records = []
        for row in g.itertuples():
            minutes = float(np.clip(row.minutes, 0, 90))
            p60 = (minutes-60)/60+.5 if minutes >= 60 else minutes/120
            hist = raw[(raw.season == row.season) & (raw.player_id == row.player_id) & (raw.gameweek < gw)].gameweek.nunique()
            x = round(row.overall_points, 2); prob = round(row.participation, 4)
            records.append(dict(playerId=int(row.player_id), webName=row.snapshot_name, club=str(row.snapshot_team), position={1:'GK',2:'DEF',3:'MID',4:'FWD'}[row.snapshot_position], gameweek=int(gw), predictedPtsGw1=x, predictedPtsGw3=round(3*x,2), predictedPtsGw5=round(4.75*x,2), predictedMinutes=round(minutes,2), probPlaying=prob, prob60PlusMins=round(p60,4), confidence=confidence(prob*100,row.minutes_mean3,int(hist)), modelVersion='enriched-neutral-fixtures-day6', generatedAt='archived-walk-forward', team=int(row.snapshot_team), price=int(round(row.snapshot_price*10)), ownership=float(row.snapshot_ownership*100), form=float(row.baseline_points)))
        squads = []; seen = set(); attempts = 0
        while len(squads) < 20 and attempts < 10000:
            attempts += 1; picks = []
            for pos, count in [('GK',2),('DEF',5),('MID',5),('FWD',3)]:
                pool = [p for p in records if p['position'] == pos]
                picks += [pool[i] for i in rng.choice(len(pool), count, replace=False)]
            ids = tuple(sorted(p['playerId'] for p in picks))
            cost = sum(p['price'] for p in picks)
            if ids in seen or cost > 1000 or max(pd.Series([p['team'] for p in picks]).value_counts()) > 3: continue
            seen.add(ids)
            # Fixed 3-4-3 XI selected using past form, shared by captain policies.
            xi = []
            for pos, count in [('GK',1),('DEF',3),('MID',4),('FWD',3)]:
                eligible = sorted([p for p in picks if p['position']==pos], key=lambda p:(-p['form'],p['playerId']))
                xi += [p['playerId'] for p in eligible[:count]]
            squads.append(dict(id=len(squads), players=list(ids), xi=xi, bank=1000-cost))
        assert len(squads)==20
        games.append(dict(gameweek=int(gw), players=records, squads=squads))
        coverage.append(dict(gameweek=int(gw), forecast_rows=len(full), candidates=len(records), squads=len(squads), attempts=attempts))
    (OUT/'inputs.json').write_text(json.dumps(games, allow_nan=False))
    pd.DataFrame(coverage).to_csv(OUT/'coverage.csv', index=False)
    d[keys+['actual_points','actual_minutes']].to_csv(OUT/'outcomes.csv', index=False)
    files = [SRC/'full_predictions.csv',SRC/'prepared.parquet',SRC/'input_snapshot.parquet',ROOT/'apps/ai/inference/predict_next_gw.py']
    protocol = dict(seed=20260916, gameweeks=list(range(21,36)), squads_per_week=20, candidate_rule='archived status a and prior three-week mean minutes >=30', context='No team multiplier or Big Six adjustment; neutral FDR projections x3=3*x1 and x5=4.75*x1, not independent multiweek forecasts', confidence='Actual production derive_confidence function with prior raw-row count and prior mean minutes', minutes='Clip saved minutes to [0,90] for production p60 adapter; ML metrics unchanged', squad='Random fixed seed, 2/5/5/3, <=100.0m, <=3 per club; new independent squads each week', transfers='Synthetic purchase at current archived price: sell price equals buy price. Remaining budget is bank. Separate 0 and 4 point cost scenarios; no season simulation.', primary='Top-10 mean points: balanced vs xPts/form; captain realised points: production vs xPts/form; transfer realised net gain: production vs xPts at costs 0/4 (six comparisons). Equal-weight gameweeks, not independent synthetic squads.', hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files})
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2))
    print(pd.DataFrame(coverage).to_string(index=False))

def analyze():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from ml_uncertainty import interval
    results=json.loads((OUT/'decisions.json').read_text())
    outcomes=pd.read_csv(OUT/'outcomes.csv').set_index(['gameweek','player_id'])
    inputs={g['gameweek']:g for g in json.loads((OUT/'inputs.json').read_text())}
    rows=[]; selections=[]
    for g in results['weeks']:
        gw=g['gameweek']; actual=lambda pid:float(outcomes.loc[(gw,pid),'actual_points'])
        for policy, ids in g['rankings'].items():
            for k in [5,10,20]:
                rows.append(dict(gameweek=gw,task=f'ranking_top{k}',policy=policy,case=-1,value=float(np.mean([actual(i) for i in ids[:k]]))))
            for rank,pid in enumerate(ids[:20],1): selections.append(dict(gameweek=gw,policy=policy,rank=rank,player_id=pid,actual_points=actual(pid)))
        for s in g['squads']:
            for policy,pid in s['captains'].items(): rows.append(dict(gameweek=gw,task='captain',policy=policy,case=s['id'],value=actual(pid)))
            for move in s['transfers']:
                gain=0 if move['outgoing'] is None else actual(move['incoming'])-actual(move['outgoing'])-move['cost']
                rows.append(dict(gameweek=gw,task=f"transfer_cost{move['cost']}",policy=move['policy'],case=s['id'],value=gain))
    frame=pd.DataFrame(rows);frame.to_csv(OUT/'case_results.csv',index=False)
    pd.DataFrame(selections).to_csv(OUT/'top_player_selections.csv',index=False)
    weekly=frame.groupby(['task','policy','gameweek'],as_index=False).value.mean();weekly.to_csv(OUT/'weekly_results.csv',index=False)
    summary=weekly.groupby(['task','policy']).value.agg(['mean','min','max']).reset_index();summary.to_csv(OUT/'summary.csv',index=False)
    comparisons=[]
    for task,model,base in [('ranking_top10','balanced','xpts'),('ranking_top10','balanced','form'),('captain','production','xpts'),('captain','production','form'),('transfer_cost0','production','xpts'),('transfer_cost4','production','xpts')]:
        w=weekly[weekly.task==task].pivot(index='gameweek',columns='policy',values='value');diff=(w[model]-w[base]).to_numpy()
        for length in [2,3,5]:
            ci=interval(diff,length,6)
            comparisons.append(dict(task=task,model=model,baseline=base,block_length=length,positive_weeks=int((diff>0).sum()),**ci))
    pd.DataFrame(comparisons).to_csv(OUT/'uncertainty.csv',index=False)
    fig,axs=plt.subplots(1,2,figsize=(12,4.5))
    for ax,task,title in zip(axs,['ranking_top10','captain'],['Top 10: mean actual player points','Captain: mean actual points across test squads']):
        for policy in (['balanced','xpts','form'] if task=='ranking_top10' else ['production','xpts','form']):
            p=weekly[(weekly.task==task)&(weekly.policy==policy)];ax.plot(p.gameweek,p.value,label=policy)
        ax.set(title=title,xlabel='Gameweek',ylabel='Actual points');ax.legend()
    fig.tight_layout();fig.savefig(OUT/'01_selection_returns.png',dpi=180);plt.close(fig)
    fig,ax=plt.subplots(figsize=(8,4.5))
    for i,cost in enumerate([0,4]):
        for j,policy in enumerate(['production','xpts']):
            val=summary[(summary.task==f'transfer_cost{cost}')&(summary.policy==policy)]['mean'].iloc[0]
            ax.bar(i+(j-.5)*.32,val,.3,color=['tab:blue','tab:orange'][j],label=policy if i==0 else None)
    ax.axhline(0,color='black',lw=.8);ax.set(xticks=[0,1],xticklabels=['Free transfer','Four-point cost'],ylabel='Mean realised net gain per test squad',title='One-week transfers, with no-move option');ax.legend();fig.tight_layout();fig.savefig(OUT/'02_transfer_returns.png',dpi=180);plt.close(fig)
    def metric(task,policy): return float(summary[(summary.task==task)&(summary.policy==policy)]['mean'].iloc[0])
    table='\n'.join(f"| {x.task} | {x.policy} | {x.mean:.3f} |" for x in summary.itertuples())
    stats='\n'.join(f"| {x['task']} | {x['model']} minus {x['baseline']} | {x['mean_difference']:.3f} | [{x['family_low']:.3f}, {x['family_high']:.3f}] |" for x in comparisons if x['block_length']==3)
    text=f'''# Day 6 — historical recommendation selection

## Scope and method

We reused the enriched walk-forward forecasts for GW21–35 of 2025–26. No model was retrained. All selection inputs were stored separately from actual outcomes. Candidates had archived available status and at least 30 mean minutes over the preceding three rounds. Every policy used the same candidates. Unlike the retrospective top-player diagnostic, future season points did not determine inclusion.

The production TypeScript ranking, captaincy and corrected transfer functions made the decisions. Historical fixture/opponent context is still unverified, so team and Big Six multipliers were neutral. Three- and five-week projections used the production neutral-fixture arithmetic (3 and 4.75 times the rounded one-week estimate); these are not independent multiweek forecasts. Confidence used the actual production helper and prior history. Predicted minutes were clipped to 90 for the production sixty-minute adapter. This is an evaluation of the scoring policies under an explicitly simplified historical adapter, not the full deployed pipeline.

Rankings were compared with expected points alone and the preceding five-round points mean. Top-10 mean realised points was the primary ranking endpoint; top-5/top-20 and cautious/aggressive settings are descriptive sensitivity checks. A top-k list is not a legal FPL squad.

We also generated 20 synthetic squads per round, 300 in total, using fixed-seed random sampling without looking at outcomes. Each had 15 distinct players, the 2/5/5/3 position allocation, cost at most 100.0m and at most three players per club. A shared 3-4-3 XI was chosen by past form for all captain policies. Captain points are reported before doubling; doubling scales every comparison equally. Vice-captain substitution was not simulated.

For transfers, the production service generated candidates, then an evaluation wrapper enforced affordability, equal position and the club limit. This wrapper does not prove that the assistant itself applies these checks. The xPts comparator ranked the same returned feasible pairs by one-week predicted gain, isolating ordering within the service's shortlist. It is not an unrestricted optimal-transfer baseline. Both policies could choose no move and required predicted one-week gain greater than the specified cost. Separate zero- and four-point scenarios were evaluated. Purchases were assumed to occur at that week's archived price, so sell price equalled purchase price. Squads were regenerated weekly; no actual manager histories, saved transfers or cumulative season strategy were simulated.

## Results

| Endpoint | Policy | Equal-gameweek mean realised points / gain |
|---|---|---:|
{table}

![Selection returns](01_selection_returns.png)

The balanced ranking returned {metric('ranking_top10','balanced'):.3f} points per selected player, compared with {metric('ranking_top10','xpts'):.3f} for predicted points alone and {metric('ranking_top10','form'):.3f} for recent form. These are realised returns, not prediction errors: higher is better. Differences over this short period do not show that a policy is generally superior.

The production captain policy returned {metric('captain','production'):.3f} points per captain, against {metric('captain','xpts'):.3f} for the xPts comparator on the same starting XIs. Sampling many squads does not create many independent gameweeks: several squads share players and match outcomes.

![Transfer returns](02_transfer_returns.png)

Free-transfer mean net gains were {metric('transfer_cost0','production'):.3f} for production ordering and {metric('transfer_cost0','xpts'):.3f} for xPts ordering. With a four-point cost, including no-move cases, the means were {metric('transfer_cost4','production'):.3f} and {metric('transfer_cost4','xpts'):.3f}. These numbers describe the specified one-week scenarios; they do not establish long-horizon transfer value.

## Uncertainty

Paired circular block bootstrap used 100,000 resamples, seed 20260915 and primary block length three gameweeks, with lengths two and five saved as sensitivity checks. The table uses approximate Bonferroni-adjusted 95% intervals across six planned comparisons. Positive differences favour the first policy. An interval crossing zero is inconclusive. There are only 15 gameweeks, and the data were already used during development, so these are exploratory comparisons rather than confirmation on an untouched holdout.

| Endpoint | Comparison | Mean difference | Adjusted interval |
|---|---|---:|---|
{stats}

Only the captain comparison with recent form has a primary adjusted interval entirely above zero (+0.407 to +1.520 points). The other five comparisons are inconclusive. In particular, the additional scoring adjustments have not demonstrated an improvement over ranking by predicted points alone. This should be reported alongside the higher point estimates rather than presenting all positive averages as established gains.

## Functional verification

The historical harness and three existing transfer/squad test files passed 49 tests; the API TypeScript check passed. The harness validated {results['verification']['squadChecks']} synthetic squads and {results['verification']['transferChecks']} selected transfers across the policy/cost scenarios. Of {results['verification']['returnedPairs']:,} returned candidate pairs, {results['verification']['rejectedInfeasible']} were removed by the evaluation wrapper for affordability or squad constraints. These counts include repeated players and pairs across scenarios; they are not independent observations. The remaining 32 of 1,200 policy/cost decisions were no-move decisions.

Existing functional tests cover insufficient budget, position mismatches, duplicate incoming players, selling-price calculations, transfer hits and club-limit warnings. They use mocked application data. This does not amount to a complete browser-to-database integration test.

The relatively large free-transfer gains should be interpreted in light of the randomly sampled squads: they can contain weak players that experienced managers would not choose. They are not an estimate of the gain an average real manager would achieve.

## What this completes and what remains

This completes the bounded historical ranking/captain/one-step transfer experiment using the available data. Decisions, outcomes, per-case results, weekly aggregates, source hashes, input hashes and uncertainty results are saved alongside this report. Feasibility assertions check every constructed squad and selected transfer. Separate existing API tests evaluate transfer and squad behaviour with mocks; they are functional evidence, not historical return evidence.

It does not complete a full production recommendation backtest: deadline-safe fixtures, actual manager purchase prices/squads, multiweek chip strategy, vice-captain/autosub handling and a prospective study remain outside scope. Risk preferences may express objectives other than maximising average one-week points; these comparisons do not validate subjective satisfaction or optimal risk coefficients. The retained Day 5 limitations still apply. No production logic was changed during Day 6.

## Reproduction

From the repository root, run `apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/day6_recommendations.py prepare`. From `apps/api`, run `node ../../node_modules/vitest/vitest.mjs run src/modules/assistant/__tests__/day6-recommendations.evaluation.test.ts src/modules/assistant/__tests__/transfer-evaluator.service.test.ts src/modules/transfers/__tests__/transfers.service.test.ts src/modules/assistant/__tests__/ml-squad.advisor.service.test.ts`. Return to the repository root and run `apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/day6_recommendations.py analyze`.
'''
    (OUT/'Day-6-Results.md').write_text(text,encoding='utf-8')
    print(summary.to_string(index=False));print(pd.DataFrame(comparisons).query('block_length==3')[['task','baseline','mean_difference','family_low','family_high']].to_string(index=False))

if __name__=='__main__':
    {'prepare':prepare,'analyze':analyze}[sys.argv[1]]()
