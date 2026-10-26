"""Offline execution of production ILP with injected historical inputs, no DB."""
from pathlib import Path
import ast, itertools, json, logging, hashlib, time
from collections import Counter
import numpy as np
import pandas as pd
import pulp

ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'output/evaluation-day8'
SOURCE=ROOT/'apps/ai/inference/optimize_initial_squad.py'

def load(frame,profile=None,baseline=None):
    tree=ast.parse(SOURCE.read_text(encoding='utf-8'))
    scope={'pd':pd,'json':json,'logger':logging.getLogger('offline-squad')}
    for name in ['LpProblem','LpMaximize','LpVariable','lpSum','LpBinary','LpStatus','PULP_CBC_CMD']:scope[name]=getattr(pulp,name)
    for node in tree.body:
        if isinstance(node,ast.Assign):
            try:value=ast.literal_eval(node.value)
            except (ValueError,TypeError):continue
            for target in node.targets:
                if isinstance(target,ast.Name):scope[target.id]=value
    nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name!='main']
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'<production-squad-optimizer>','exec'),scope)
    def read_sql(query,params=None):
        if query==scope['CANDIDATE_QUERY']:return frame.copy(deep=True)
        if query==scope['USER_PROFILE_QUERY']:return pd.DataFrame([profile]) if profile is not None else pd.DataFrame()
        raise AssertionError('Unexpected database request')
    scope['read_sql']=read_sql
    if baseline is not None:scope['compute_objective']=lambda row,w:float(row[baseline])
    return scope

def validate(result,frame,budget=1000):
    assert result['status']=='OPTIMAL',result
    ids=[p['player_id'] for p in result['squad']];assert len(set(ids))==15
    chosen=frame.set_index('player_id').loc[ids]
    assert chosen.position.value_counts().to_dict()=={1:2,2:5,3:5,4:3}
    assert chosen.team_id.value_counts().max()<=3
    assert chosen.now_cost.sum()<=budget
    assert np.isclose(result['budget_used'],chosen.now_cost.sum()/10)
    return ids

def main():
    OUT.mkdir(exist_ok=True)
    data=json.loads((ROOT/'output/evaluation-day6/inputs.json').read_text())
    predictions=pd.read_csv(ROOT/'output/evaluation-enriched/full_predictions.csv').set_index(['gameweek','player_id'])
    outcomes=pd.read_parquet(ROOT/'output/evaluation-enriched/input_snapshot.parquet')
    outcomes=outcomes[outcomes.season=='2025-26'].set_index(['gameweek','player_id'])
    assert outcomes.index.is_unique
    records=[];decisions=[];solve_times=[];first=None
    for week in data:
        gw=week['gameweek']
        frame=pd.DataFrame([dict(player_id=p['playerId'],web_name=p['webName'],team_id=p['team'],team_short_name='NEUTRAL',position={'GK':1,'DEF':2,'MID':3,'FWD':4}[p['position']],now_cost=p['price'],selected_by_percent=p['ownership'],prob_playing=p['probPlaying'],predicted_pts_gw1=p['predictedPtsGw1'],predicted_pts_if_starts=float(predictions.loc[(gw,p['playerId']),'conditional_points']),predicted_pts_gw5=p['predictedPtsGw5'],confidence=p['confidence'],form=p['form']) for p in week['players']])
        # Standardised candidates from Day 6; not a test of the live SQL selection.
        for policy in ['personalised','xpts','form','short_horizon','long_horizon']:
            profile=dict(riskTolerance=2,budgetStyle=2,preferredFocus=2,differentialPreference=2,planningHorizon={'short_horizon':1,'long_horizon':3}.get(policy,2),explanationDepth=2,notes='{}')
            namespace=load(frame,profile,{'xpts':'predicted_pts_gw1','form':'form'}.get(policy))
            np.random.seed(20260916) # only the browsable shortlist uses random sampling
            start=time.perf_counter();result=namespace['optimize_squad']('offline-profile');elapsed=time.perf_counter()-start
            ids=validate(result,frame);solve_times.append(elapsed)
            # Same lineup rule for every squad: maximise pre-deadline xPts over legal formations.
            selected=frame[frame.player_id.isin(ids)]
            best=None
            for defenders in range(3,6):
                for forwards in range(1,4):
                    midfielders=10-defenders-forwards
                    if not 2<=midfielders<=5:continue
                    xi=[]
                    for pos,n in [(1,1),(2,defenders),(3,midfielders),(4,forwards)]:
                        xi+=selected[selected.position==pos].sort_values(['predicted_pts_gw1','player_id'],ascending=[False,True]).head(n).player_id.tolist()
                    xp=float(selected[selected.player_id.isin(xi)].predicted_pts_gw1.sum())
                    if best is None or xp>best[0]:best=(xp,xi)
            xi=best[1];captain=int(selected[selected.player_id.isin(xi)].sort_values(['predicted_pts_gw1','player_id'],ascending=[False,True]).iloc[0].player_id)
            decision=dict(gameweek=gw,policy=policy,squad=ids,xi=xi,captain=captain,budget=result['budget_used'],objective=result['objective_value'],seconds=elapsed)
            decisions.append(decision)
            # Use the same 11 start weeks for all outcome horizons (latest target GW35).
            if gw<=31:
                for horizon in [1,3,5]:
                    keys=[(g,pid) for g in range(gw,gw+horizon) for pid in xi]
                    assert all(key in outcomes.index for key in keys),'Missing outcome: do not silently fill with zero'
                    points=float(outcomes.loc[keys,'total_points'].sum()+outcomes.loc[[(g,captain) for g in range(gw,gw+horizon)],'total_points'].sum())
                    records.append(dict(gameweek=gw,policy=policy,horizon=horizon,actual_points=points))
            if first is None:first=(frame,result,profile)
    frame,result,profile=first;checks={}
    normal=load(frame,profile);ids=validate(result,frame)
    checks['empty_pool']=load(frame.iloc[:0])['optimize_squad'](None)['status']=='INFEASIBLE'
    checks['insufficient_budget']=normal['optimize_squad']('offline-profile',budget_tenths=1)['status']=='INFEASIBLE'
    forced=normal['optimize_squad']('offline-profile',forced_in_ids=[ids[0]],forced_out_ids=[ids[1]])
    forcedids=validate(forced,frame);checks['forced_constraints']=ids[0] in forcedids and ids[1] not in forcedids
    checks['contradictory_constraints']=normal['optimize_squad']('offline-profile',forced_in_ids=[ids[0]],forced_out_ids=[ids[0]])['status']=='INFEASIBLE'
    unknown=normal['optimize_squad']('offline-profile',forced_in_ids=[-999])
    checks['unknown_forced_id_ignored']=unknown['status']=='OPTIMAL' and -999 not in [p['player_id'] for p in unknown['squad']]
    custom=normal['optimize_squad']('offline-profile',budget_tenths=900);validate(custom,frame,900)
    checks['custom_budget_left_uses_100m']=np.isclose(custom['budget_left'],100-custom['budget_used']) and not np.isclose(custom['budget_left'],90-custom['budget_used'])
    # Independent enumeration: same 17 candidates, all 136 possible 15-player subsets.
    extras=frame[~frame.player_id.isin(ids)].head(2).player_id.tolist();small=frame[frame.player_id.isin(ids+extras)]
    ns=load(small,profile);smallresult=ns['optimize_squad']('offline-profile');validate(smallresult,small)
    w=ns['derive_squad_weights'](pd.Series(profile));best=-float('inf');feasible=0
    for subset in itertools.combinations(small.index,15):
        part=small.loc[list(subset)]
        if part.position.value_counts().to_dict()!={1:2,2:5,3:5,4:3} or part.now_cost.sum()>1000 or part.team_id.value_counts().max()>3:continue
        feasible+=1;best=max(best,sum(ns['compute_objective'](r,w) for _,r in part.iterrows()))
    checks['matches_exhaustive_objective']=bool(np.isclose(best,smallresult['objective_value']))
    assert all(checks.values()),checks
    pd.DataFrame(records).to_csv(OUT/'returns.csv',index=False)
    (OUT/'decisions.json').write_text(json.dumps(decisions,indent=2))
    (OUT/'verification.json').write_text(json.dumps(dict(checks=checks,historical_solves=len(decisions),historical_all_optimal=True,enumerated_subsets=136,feasible_enumerated_subsets=feasible,median_seconds=float(np.median(solve_times)),max_seconds=max(solve_times),source_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),scope='Offline production solver/function bodies; injected candidates, no SQL execution; fixture-neutral projections; fixed XI and captain with no transfers, autosubs or chips'),indent=2))
    print(pd.DataFrame(records).groupby(['horizon','policy']).actual_points.mean().to_string());print(checks)

if __name__=='__main__':main()
