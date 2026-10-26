"""Audit public as-of fixture revisions without claiming weekly capture coverage."""
from pathlib import Path
from datetime import datetime
import ast, gzip, hashlib, json, sys
import pandas as pd
import requests

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/evaluation-day7'
REPO='vaastav/Fantasy-Premier-League'
PATH='data/2025-26/fixtures.csv'

def production_helpers():
    source=(ROOT/'apps/ai/inference/predict_next_gw.py').read_text(encoding='utf-8')
    names={'build_fixture_features','project_multi_gw'}
    nodes=[n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name in names]
    definitions=(ROOT/'apps/ai/constants.py').read_text(encoding='utf-8')
    constants={}
    for n in ast.parse(definitions).body:
        if isinstance(n,ast.AnnAssign) and isinstance(n.target,ast.Name) and n.target.id in ['FDR_NEUTRAL','FDR_MULTIPLIER']:
            constants[n.target.id]=ast.literal_eval(n.value)
        if isinstance(n,ast.Assign):
            for target in n.targets:
                if isinstance(target,ast.Name) and target.id in ['FDR_NEUTRAL','FDR_MULTIPLIER']:constants[target.id]=ast.literal_eval(n.value)
    scope={'pd':pd,**constants}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'<production-fixture-functions>','exec'),scope)
    return scope

def acquire():
    OUT.mkdir(exist_ok=True); cache=OUT/'sources';cache.mkdir(exist_ok=True)
    index=cache/'fixture_commits.json'
    if not index.exists():
        r=requests.get(f'https://api.github.com/repos/{REPO}/commits',params={'path':PATH,'until':'2026-06-01T00:00:00Z','per_page':100},timeout=30);r.raise_for_status();index.write_text(r.text)
    commits=json.loads(index.read_text());rows=[];teamrows=[];manifests=[]
    for directory in sorted((ROOT/'output/historical-data-research/captures').glob('GW*')):
        m=json.loads((directory/'manifest.json').read_text());gw=m['event']
        if not 21<=gw<=35:continue
        deadline=pd.Timestamp(m['event_deadline']);cutoff=pd.Timestamp(m['captured_at'])
        eligible=[c for c in commits if pd.Timestamp(c['commit']['committer']['date'])<cutoff]
        c=max(eligible,key=lambda c:c['commit']['committer']['date']);sha=c['sha'];date=c['commit']['committer']['date']
        path=cache/f'{sha}.csv';url=f'https://raw.githubusercontent.com/{REPO}/{sha}/{PATH}'
        if not path.exists():
            r=requests.get(url,timeout=30);r.raise_for_status();path.write_bytes(r.content)
        f=pd.read_csv(path);assert len(f)==380 and f.id.nunique()==380
        payload=json.loads(gzip.decompress((directory/'bootstrap-static.json.gz').read_bytes()))
        teamids={t['id'] for t in payload['teams']}
        assert set(f.team_h).union(f.team_a)==teamids
        target=f[f.event==gw]
        assert not target.finished.any() and target[['team_h_score','team_a_score']].isna().all().all()
        assert (pd.to_datetime(target.kickoff_time,utc=True).dropna()>deadline).all()
        assert target[['team_h_difficulty','team_a_difficulty']].isin(range(1,6)).all().all()
        age=(deadline-pd.Timestamp(date)).total_seconds()/86400
        counts=pd.concat([target.team_h,target.team_a]).value_counts()
        rows.append(dict(gameweek=gw,deadline=m['event_deadline'],revision_date=date,revision_age_days=age,sha=sha,fixtures=len(target),blank_teams=sum(counts.get(t,0)==0 for t in teamids),double_teams=sum(counts.get(t,0)>1 for t in teamids),within_48h=age<=2))
        for team in sorted(teamids):
            for horizon in [1,3,5]:
                subset=f[f.event.between(gw,gw+horizon-1)&((f.team_h==team)|(f.team_a==team))]
                difficulty=[x.team_h_difficulty if x.team_h==team else x.team_a_difficulty for x in subset.itertuples()]
                teamrows.append(dict(gameweek=gw,team=team,horizon=horizon,fixture_count=len(subset),mean_fdr=sum(difficulty)/len(difficulty) if difficulty else None,fixture_ids=';'.join(map(str,subset.id))))
        manifests.append(dict(gameweek=gw,url=url,revision=sha,revision_time=date,metadata_capture=m['captured_at'],deadline=m['event_deadline'],sha256=hashlib.sha256(path.read_bytes()).hexdigest(),evidence='Repository commit metadata, not independently timestamped API capture'))
    pd.DataFrame(rows).to_csv(OUT/'coverage.csv',index=False)
    pd.DataFrame(teamrows).to_csv(OUT/'asof_team_fixture_counts.csv',index=False)
    (OUT/'provenance.json').write_text(json.dumps(manifests,indent=2))
    print(pd.DataFrame(rows).drop(columns=['sha','deadline']).to_string(index=False))

def prepare_sensitivity():
    inputs=json.loads((ROOT/'output/evaluation-day6/inputs.json').read_text())
    provenance={m['gameweek']:m for m in json.loads((OUT/'provenance.json').read_text())}
    h=production_helpers();diagnostics=[]
    for week in inputs:
        gw=week['gameweek'];m=provenance[gw];f=pd.read_csv(OUT/'sources'/f"{m['revision']}.csv")
        f=f[f.event.between(gw,gw+2)].sort_values(['event','kickoff_time','id'])
        teamfixtures=[]
        for row in f.itertuples():
            teamfixtures.extend([dict(player_id=row.team_h,gameweek=row.event,fdr=row.team_h_difficulty,is_home=True),dict(player_id=row.team_a,gameweek=row.event,fdr=row.team_a_difficulty,is_home=False)])
        features=h['build_fixture_features'](pd.Series(range(1,21)),pd.DataFrame(teamfixtures),gw).set_index('player_id')
        for p in week['players']:
            values=features.loc[p['team']];old=p['predictedPtsGw3']
            p['predictedPtsGw3'],p['predictedPtsGw5']=h['project_multi_gw'](p['predictedPtsGw1'],values.avg_fdr_next3,values.next_gw_fdr)
            diagnostics.append(dict(gameweek=gw,player_id=p['playerId'],team=p['team'],next_fdr=values.next_gw_fdr,average_next3=values.avg_fdr_next3,neutral_gw3=old,archived_gw3=p['predictedPtsGw3']))
    (OUT/'sensitivity-inputs.json').write_text(json.dumps(inputs,allow_nan=False))
    pd.DataFrame(diagnostics).to_csv(OUT/'projection_changes.csv',index=False)

def report():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    coverage=pd.read_csv(OUT/'coverage.csv');decisions=json.loads((OUT/'sensitivity-decisions.json').read_text())
    outcomes=pd.read_csv(ROOT/'output/evaluation-day6/outcomes.csv').set_index(['gameweek','player_id'])
    rows=[]
    for w in decisions:
        old=w['neutral'][:10];new=w['fixtures'][:10]
        points=lambda ids:float(outcomes.loc[[(w['gameweek'],pid) for pid in ids],'actual_points'].mean())
        rows.append(dict(gameweek=w['gameweek'],neutral_top10_points=points(old),archived_top10_points=points(new),difference=points(new)-points(old),overlap=len(set(old)&set(new))))
    results=pd.DataFrame(rows).merge(coverage[['gameweek','revision_age_days','within_48h']],on='gameweek');results.to_csv(OUT/'sensitivity_results.csv',index=False)
    fig,axes=plt.subplots(2,1,figsize=(9,7))
    axes[0].bar(coverage.gameweek,coverage.revision_age_days,color=['tab:blue' if b else 'gray' for b in coverage.within_48h]);axes[0].axhline(2,color='red',ls='--',label='48-hour screening threshold');axes[0].set(ylabel='Days since fixture revision',title='Most recovered fixture revisions are stale');axes[0].legend()
    axes[1].plot(results.gameweek,results.neutral_top10_points,label='Neutral fixtures');axes[1].plot(results.gameweek,results.archived_top10_points,label='Archived revisions (mostly stale)');axes[1].set(xlabel='Gameweek',ylabel='Top-10 mean actual points',title='Exploratory projection sensitivity only');axes[1].legend();fig.tight_layout();fig.savefig(OUT/'fixture_audit_and_sensitivity.png',dpi=180);plt.close(fig)
    fresh=results[results.within_48h]
    table='\n'.join(f"| {int(r.gameweek)} | {r.revision_age_days:.2f} | {int(r.fixtures)} | {int(r.blank_teams)} | {int(r.double_teams)} |" for r in coverage.itertuples())
    h=production_helpers();double_a=h['project_multi_gw'](4,3.5,2);double_b=h['project_multi_gw'](4,3.5,5)
    text=f'''# Day 7 — historical fixture audit and limited sensitivity experiment

## Status

The source audit, controlled fixture tests and a limited ranking sensitivity experiment are complete. **The complete historical fixture-effects evaluation remains incomplete.** The retrieved archive does not provide sufficiently recent, independently timestamped fixture captures for all 15 deadlines. No production code, trained model or earlier evaluation result was replaced.

## Data recovered and checked

We located official-format fixture CSVs in the Git history of [Vaastav's dataset](https://github.com/vaastav/Fantasy-Premier-League). Each gameweek uses the latest file-changing revision strictly before our existing bootstrap capture, which itself precedes the deadline. Three different fixture revisions cover GW21–35. Each has 380 unique fixture IDs, valid home/away team IDs and difficulty ratings. Target-round fixtures have no recorded results and no completed status, and their recorded kickoff times follow the deadline. Downloaded bytes, hashes, exact revision URLs and times are saved in `sources/` and `provenance.json`.

Git commit timestamps are provenance evidence, not independently authenticated API capture times. Revision age measures time since the saved fixture file changed; it does not prove the schedule was wrong, nor prove it remained current. We use 48 hours as a transparent screening threshold, not as a validated guarantee. Only GW25 and GW30 pass that screen. We did not replace old snapshots with end-of-season data.

| GW | Revision age, days | Recorded fixtures | Recorded blank teams | Recorded double teams |
|---|---:|---:|---:|---:|
{table}

These are the schedules in the archived revisions, not verified final schedules. In particular, the March revision cannot establish what was known immediately before late-season rescheduling. It records two double teams in GW26 and four blank teams in GW31; counts for other weeks must not be treated as authoritative absence of blanks or doubles.

## Other sources investigated

- [FPL-Armband backfill](https://github.com/beeradb/FPL-Armband/blob/main/docs/backfill.md) describes historical bootstrap recovery, not historical fixture captures. The local manifests contain bootstrap only.
- [FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights) revision `a9635e07de1da2c8e852953e46228b1242b683ae` predates GW21 and contains fixture records. The inspected GW21 file has missing kickoff times and no official FDR fields; its match-round assignments are not independently established as FPL event assignments for rearranged games. It was not merged as if it were the official fixtures API.
- Internet Archive fixture lookups returned HTTP 503; the alternate availability lookup returned HTTP 429. No fixture snapshot was acquired through those requests. Those access failures do not establish that no snapshots exist.
- Other candidate repository histories examined did not supply usable pre-GW21 fixtures during this search. This was a bounded search, not proof that no other public archive exists.

## Actual implementation checks

Five Python tests passed. They execute the existing production fixture helper bodies with their actual constants, isolated from database setup. Tests document current behaviour rather than declaring every behaviour correct.

1. The inference three-round window correctly excludes a fixture in target GW+3.
2. An empty fixture list produces neutral FDR values. Given a nonzero one-week forecast of 4, the horizon formula still returns 12 and 19, rather than recognising zero fixtures. There is no fixture-count input to this formula.
3. A double-gameweek uses the first target-round fixture for `next_gw_fdr`. With difficulties 2 and 5, reversing those equal-round rows changes the three-week projection from {double_a[0]} to {double_b[0]} for the same starting forecast of 4; the five-week output stays 19. The average difficulty is 3.5 in both cases. Stable fixture ordering helps reproducibility but does not make this an aggregate double-gameweek model.
4. Training's `shift(-1).rolling(3)` is not a forward three-round mean. For difficulties 1,2,3,4,5, the middle row gets 3 rather than the mean 4.5 of its remaining future rows. This confirms the earlier training-feature limitation. The enriched historical ML experiment excluded this feature, so its existing metrics are unaffected.
5. Every saved fixture revision predates the metadata capture and deadline.

The TypeScript opponent lookup also retains only one fixture per team. Therefore a reliable archive alone would not make the current application fully blank/double aware. Changing this would require a defined aggregation method and separate validation, rather than silently altering the finished app during evaluation.

## Limited sensitivity experiment

We reused Day 6's exact candidate pools, forecasts, profile and ownership inputs. Only the three/five-week projection inputs were passed through the production FDR helper and horizon formula using the archived schedule. Upcoming fixtures were ordered by event, kickoff and fixture ID. We then ran the actual TypeScript ranking function. One-week predicted points, team-strength multipliers and captaincy inputs were unchanged. This is not a retrained fixture-aware model or an evaluation of all fixture effects.

Across the 15 rounds, the neutral top-10 mean was {results.neutral_top10_points.mean():.3f}; using the archived revisions gave {results.archived_top10_points.mean():.3f}, a difference of {results.difference.mean():+.3f} actual points per selected player. The mean top-10 overlap was {results.overlap.mean():.2f}/10. Because most revisions are stale, these are diagnostic results only, not a headline claim about correct fixture context.

Across the two rounds passing the 48-hour screen, the corresponding means were {fresh.neutral_top10_points.mean():.3f} and {fresh.archived_top10_points.mean():.3f}. Two gameweeks are insufficient for a reliable general conclusion, so no significance claim or new bootstrap result is offered.

![Fixture provenance and sensitivity](fixture_audit_and_sensitivity.png)

## What is still needed

To finish the original Day 7 scope, obtain sufficiently recent official-format fixture snapshots (or verified schedule-change histories) for the remaining deadlines, including unassigned/postponed fixtures. Check FPL event assignment, source time, teams, opponents, venue and FDR separately. Then define and validate blank/double aggregation before rerunning the affected production-model and recommendation comparisons. Do not multiply already gameweek-level point forecasts by fixture count without validating their target semantics.

The current finding is useful thesis evidence: fixtures can change rankings, but the present data and implementation do not support claiming a complete historical fixture evaluation. Days 1–6 remain preserved with their existing limitations.

## Reproduction

`apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/day7_fixtures.py acquire` downloads/caches revisions and writes coverage. Use `prepare` to create the isolated projection inputs. From `apps/api`, run the `day7-fixtures.evaluation.test.ts` Vitest file to produce ranking decisions, then run this Python script with `report`. Run `python -m pytest apps/ai/tests/test_day7_fixtures.py -q` for the five fixture checks.
'''
    (OUT/'Day-7-Results.md').write_text(text,encoding='utf-8')
    paths=[ROOT/'apps/ai/inference/predict_next_gw.py',ROOT/'apps/ai/features/player_features.py',ROOT/'apps/ai/constants.py',ROOT/'apps/api/src/modules/assistant/player-ranking.service.ts',Path(__file__)]
    (OUT/'verification.json').write_text(json.dumps(dict(status='partial: archive freshness and fixture semantics unresolved',python_tests=5,revision_count=coverage.sha.nunique(),within48h=int(coverage.within_48h.sum()),sensitivity_mean_difference=float(results.difference.mean()),source_hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}),indent=2))
    print(results.to_string(index=False))

if __name__=='__main__':{'acquire':acquire,'prepare':prepare_sensitivity,'report':report}[sys.argv[1] if len(sys.argv)>1 else 'acquire']()
