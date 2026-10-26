"""Independent audit of exported decisions, feasibility and reported means."""
from pathlib import Path
import csv, hashlib, json, math
from collections import Counter, defaultdict

ROOT=Path(__file__).resolve().parents[3]; OUT=ROOT/'output/evaluation-day6'
inputs=json.loads((OUT/'inputs.json').read_text()); decisions=json.loads((OUT/'decisions.json').read_text())
assert hashlib.sha256((OUT/'inputs.json').read_bytes()).hexdigest()==decisions['inputHash']
with (OUT/'outcomes.csv').open() as f:
    outcomes={(int(r['gameweek']),int(r['player_id'])):float(r['actual_points']) for r in csv.DictReader(f)}
values=defaultdict(list); counts=Counter(); checks=0
for source, result in zip(inputs,decisions['weeks'],strict=True):
    gw=source['gameweek']; assert gw==result['gameweek']
    players={p['playerId']:p for p in source['players']}
    for policy,ids in result['rankings'].items():
        assert len(set(ids))==len(players) and set(ids)==set(players)
        for k in [5,10,20]:values[(f'ranking_top{k}',policy,gw)].append(sum(outcomes[gw,p] for p in ids[:k])/k)
    for original,s in zip(source['squads'],result['squads'],strict=True):
        assert original['id']==s['id']
        squad=[players[p] for p in original['players']]
        assert Counter(p['position'] for p in squad)==dict(GK=2,DEF=5,MID=5,FWD=3)
        assert Counter(players[p]['position'] for p in original['xi'])==dict(GK=1,DEF=3,MID=4,FWD=3)
        for policy,p in s['captains'].items():
            assert p in original['xi']; values[('captain',policy,gw)].append(outcomes[gw,p])
        for m in s['transfers']:
            key=(f"transfer_cost{m['cost']}",m['policy'],gw)
            if m['outgoing'] is None:
                assert m['incoming'] is None; values[key].append(0); counts['no_move']+=1;continue
            old=players[m['outgoing']]; new=players[m['incoming']]
            assert old['playerId'] in original['players'] and new['playerId'] not in original['players']
            assert old['position']==new['position'] and original['bank']+old['price']>=new['price']
            changed=[p for p in squad if p['playerId']!=old['playerId']]+[new]
            assert max(Counter(p['team'] for p in changed).values())<=3
            assert m['predictedGain']>m['cost']
            values[key].append(outcomes[gw,new['playerId']]-outcomes[gw,old['playerId']]-m['cost'])
            counts[f"moves_{m['policy']}_cost{m['cost']}"]+=1;checks+=1
means=defaultdict(list)
for (task,policy,gw),v in values.items():means[task,policy].append(sum(v)/len(v))
with (OUT/'summary.csv').open() as f:
    for row in csv.DictReader(f):
        v=means[row['task'],row['policy']];assert len(v)==15
        assert math.isclose(sum(v)/15,float(row['mean']),abs_tol=1e-12)
paths=[Path(__file__),ROOT/'apps/ai/evaluation/day6_recommendations.py',ROOT/'apps/api/src/modules/assistant/__tests__/day6-recommendations.evaluation.test.ts']
verification=dict(status='passed', independently_verified_transfer_actions=checks, decision_counts=dict(counts), summary_rows_verified=len(means), source_hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
(OUT/'verification.json').write_text(json.dumps(verification,indent=2)); print(json.dumps(verification,indent=2))
