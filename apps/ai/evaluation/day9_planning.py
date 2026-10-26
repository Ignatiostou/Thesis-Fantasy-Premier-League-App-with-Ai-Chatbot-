"""Day 9: deadline-only inputs for a persistent-squad evaluation adapter."""
from pathlib import Path
import ast,json,hashlib
import pandas as pd
import numpy as np

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/evaluation-day9'
SRC=ROOT/'output/evaluation-enriched-gw21-38'

def main():
 OUT.mkdir(exist_ok=True)
 pred=pd.read_csv(SRC/'full_predictions.csv');feat=pd.read_parquet(SRC/'prepared.parquet')
 keys=['season','player_id','gameweek']
 d=pred.merge(feat[keys+['snapshot_name','snapshot_position','snapshot_team','snapshot_price','snapshot_ownership','status_a','minutes_mean3']],on=keys,validate='one_to_one')
 raw=pd.read_parquet(SRC/'input_snapshot.parquet').sort_values(keys)
 raw['history_count']=raw.groupby(['season','player_id']).cumcount()
 d=d.merge(raw[keys+['history_count']],on=keys,validate='one_to_one')
 source=(ROOT/'apps/ai/inference/predict_next_gw.py').read_text(encoding='utf-8')
 node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='derive_confidence')
 scope={};exec(compile(ast.Module(body=[node],type_ignores=[]),'<production-confidence>','exec'),scope)
 weeks=[]
 for gw,g in d.groupby('gameweek'):
  players=[]
  for r in g.itertuples():
   mins=float(np.clip(r.minutes,0,90));x=round(r.overall_points,2);prob=round(r.participation,4)
   players.append(dict(playerId=int(r.player_id),webName=r.snapshot_name,club=str(r.snapshot_team),position={1:'GK',2:'DEF',3:'MID',4:'FWD'}[r.snapshot_position],gameweek=int(gw),predictedPtsGw1=x,predictedPtsGw3=round(3*x,2),predictedPtsGw5=round(4.75*x,2),predictedMinutes=round(mins,2),probPlaying=prob,prob60PlusMins=round((mins-60)/60+.5 if mins>=60 else mins/120,4),confidence=scope['derive_confidence'](prob*100,r.minutes_mean3,int(r.history_count)),modelVersion='enriched-neutral-fixtures-day9',generatedAt='archived',team=int(r.snapshot_team),price=int(round(r.snapshot_price*10)),ownership=float(r.snapshot_ownership*100),form=float(r.baseline_points),eligibleIncoming=bool(r.status_a==1 and r.minutes_mean3>=30)))
  weeks.append(dict(gameweek=int(gw),players=players))
 initial=json.loads((ROOT/'output/evaluation-day6/inputs.json').read_text())[0]['squads']
 payload=dict(weeks=weeks,initial=initial)
 (OUT/'inputs.json').write_text(json.dumps(payload,indent=2))
 outcomes=[dict(gameweek=int(r.gameweek),playerId=int(r.player_id),totalPoints=float(r.actual_points),minutes=float(r.actual_minutes)) for r in pred.itertuples()]
 (OUT/'outcomes.json').write_text(json.dumps(outcomes))
 protocol=dict(scope='Persistent synthetic squads, GW21-38, not real managers or a season-long optimal planner',initial='Same 20 deadline-only GW21 squads as Day 6; identical for all policies',policies=['app_short','app_balanced','app_long','xpts_global','form_global','hold'],transfer_rule='At most two sequential one-player moves per round. New incoming players cannot be sold in the same round. Move gain must exceed the actual incremental hit; no move allowed. App scorer used for app policies; exhaustive feasible pairs for baseline policies.',finance='Purchase prices persist; production half-profit selling-price helper used. Start with one free transfer, roll up to app cap two. At most four hit points per round.',lineup='Shared legal XI maximising current risk-adjusted points; captain and vice by the same forecast. Bench sorted by forecast, reserve GK last.',scoring='Production scoring helper with automatic substitutions and captain fallback; actual outcomes loaded only after all decisions are saved.',chip='No implemented deterministic multiweek chip optimiser found. Separate rule tests and one-week counterfactual Bench Boost/Triple Captain increments; no claim these constitute a chip strategy.',limitations=['Neutral fixtures and proportional horizons retained from Days 6-8.','App rules differ from official 2025-26 chip inventory and five-transfer cap.','No Wildcard/Free Hit strategy or globally optimal transfer sequences.','Many synthetic squads share players: descriptive paired results, not independent trials.','Not live LLM or database integration evaluation.'],input_sha256=hashlib.sha256((OUT/'inputs.json').read_bytes()).hexdigest())
 (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2))
 print(len(weeks),'rounds;',len(initial),'initial squads;',len(d),'forecast rows')

if __name__=='__main__':main()
