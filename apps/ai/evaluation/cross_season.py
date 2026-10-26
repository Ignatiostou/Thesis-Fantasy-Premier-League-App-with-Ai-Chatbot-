"""Frozen 2025-26 training; archived-input 2026-27 GW1-4 evaluation.

Run from repository root. No production models or configuration are changed.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, shutil, time
import numpy as np
import pandas as pd
import requests
import temporal_evaluation as ev
from run_enriched import GROUPS, FEATURES, snapshot_rows

OUT = Path('output/evaluation-cross-season-2026-27')
PIN = 'f8735a02e5c4abb018521f241340429c906d23ae'

def get(url):
    r = requests.get(url, timeout=90)
    r.raise_for_status()
    return r

def save_json(path, obj):
    path.write_text(json.dumps(obj, indent=2), encoding='utf-8')

def acquire():
    OUT.mkdir(exist_ok=True)
    cap = OUT/'captures'; cap.mkdir(exist_ok=True)
    if not (OUT/'input_snapshot.parquet').exists():
        shutil.copy2('apps/ai/artifacts/datasets/player_gw_history.parquet', OUT/'input_snapshot.parquet')
    current = get('https://fantasy.premierleague.com/api/bootstrap-static/').json()
    save_json(OUT/'current-bootstrap-outcome-check-only.json', current)
    audit = []
    old_meta = pd.read_parquet('output/evaluation-enriched/snapshot_features.parquet')
    listing = get(f'https://api.github.com/repos/beeradb/FPL-Armband/contents/data/captures/2025-26?ref={PIN}').json()
    extras = []
    for gw in (37, 38):
        entry = next(x for x in listing if x['name'].startswith(f'GW{gw:02}-'))
        base = f'https://raw.githubusercontent.com/beeradb/FPL-Armband/{PIN}/{entry["path"]}/'
        m = get(base+'manifest.json').json()
        b = get(base+'bootstrap-static.json.gz').content
        (cap/f'2025-26-GW{gw}.json.gz').write_bytes(b)
        save_json(cap/f'2025-26-GW{gw}-manifest.json', m)
        plain = gzip.decompress(b)
        assert hashlib.sha256(plain).hexdigest() == next(x['sha256'] for x in m['files'] if x['name']=='bootstrap-static.json.gz')
        extras.extend(snapshot_rows(json.loads(plain), m))
        audit.append(dict(season='2025-26', gameweek=gw, url=base, captured_at=m['captured_at'], sha256=hashlib.sha256(plain).hexdigest()))
    pd.concat([old_meta, pd.DataFrame(extras)], ignore_index=True).to_parquet(OUT/'training_metadata.parquet', index=False)
    new_rows = []
    for gw in range(1,5):
        event = next(e for e in current['events'] if e['id']==gw)
        assert event['finished']
        deadline = event['deadline_time']
        commits = get(f'https://api.github.com/repos/TopMarx/fpl/commits?until={deadline}&per_page=1').json()
        c = commits[0]; ref = c['sha']; stamp = c['commit']['committer']['date']
        base = f'https://raw.githubusercontent.com/TopMarx/fpl/{ref}/data/2026/'
        b = get(base+'fpl-bootstrap_2026.json').content
        payload = json.loads(b)
        manifest = get(base+'fetch-manifest.json').json()
        assert pd.Timestamp(manifest['last_run']) < pd.Timestamp(deadline)
        assert pd.Timestamp(stamp) < pd.Timestamp(deadline)
        m = dict(event=gw, captured_at=stamp, event_deadline=deadline)
        # Some newly promoted teams have unavailable strength fields. Keep them
        # missing for training-only imputation, never invent a team rating.
        for team in payload['teams']:
            for col in GROUPS['team_strength']:
                if team[col[5:]] is None: team[col[5:]]=np.nan
        rows = snapshot_rows(payload, m)
        for row in rows: row['season']='2026-27'
        new_rows.extend(rows)
        (cap/f'2026-27-GW{gw}.json').write_bytes(b)
        save_json(cap/f'2026-27-GW{gw}-manifest.json', manifest)
        audit.append(dict(season='2026-27', gameweek=gw, commit=ref, committed_at=stamp, fetch_timestamp=manifest['last_run'], deadline=deadline, url=base+'fpl-bootstrap_2026.json', sha256=hashlib.sha256(b).hexdigest(), players=len(rows)))
        print('Archived metadata',gw,len(rows),stamp,flush=True)
    pd.DataFrame(new_rows).to_parquet(OUT/'test_metadata.parquet',index=False)
    save_json(OUT/'sources.json',audit)

def build_test(raw, old_meta, new_meta):
    """Previous five calendar rounds may cross summer; season totals reset.

    Absent observations stay missing. New arrivals receive train-only imputation.
    Prior 2026-27 outcomes update inputs, but never estimator parameters.
    """
    old_map = old_meta[['player_id','player_code']].drop_duplicates()
    assert not old_map.player_id.duplicated().any()
    new_map = new_meta[['player_id','player_code']].drop_duplicates()
    assert not new_map.player_id.duplicated().any()
    history = raw[raw.season.eq('2025-26')].merge(old_map,on='player_id',validate='many_to_one')
    new = raw[raw.season.eq('2026-27') & raw.gameweek.le(4)].merge(new_map,on='player_id',validate='many_to_one')
    assert not history.duplicated(['player_code','gameweek']).any()
    assert not new.duplicated(['player_code','gameweek']).any()
    old_groups = {k:g.set_index('gameweek') for k,g in history.groupby('player_code')}
    new_groups = {k:g.set_index('gameweek') for k,g in new.groupby('player_code')}
    rows=[]
    for meta in new_meta.to_dict('records'):
        code,gw=meta['player_code'],meta['gameweek']
        cur=new_groups.get(code)
        if cur is None or gw not in cur.index: continue
        target=cur.loc[gw]
        old=old_groups.get(code, pd.DataFrame(columns=raw.columns))
        prior=cur[cur.index<gw]
        numeric_cols=list(dict.fromkeys(list(ev.ROLLING)+ev.CUMULATIVE))
        sequence=pd.concat([old.reindex(range(34,39))[numeric_cols].astype(float),prior.reindex(range(1,gw))[numeric_cols].astype(float)],ignore_index=True)
        row=dict(meta, actual_points=float(target.total_points),actual_minutes=float(target.minutes),actual_played=float(target.minutes>=30),returning_player=bool(len(old)),prior_season_player_id=int(old.player_id.iloc[0]) if len(old) else None)
        row['prior_five_observed']=int(sequence.tail(5).total_points.notna().sum())
        for source,specs in ev.ROLLING.items():
            for name,w in specs: row[name]=pd.to_numeric(sequence[source]).tail(w).mean()
        row['points_std5']=pd.to_numeric(sequence.total_points).tail(5).std()
        for col in ev.CUMULATIVE: row[col+'_sum']=float(prior[col].sum()) if len(prior) else 0.
        row['points_mean_history']=prior.total_points.mean() if len(prior) else np.nan
        qualified=sequence.total_points.where(sequence.minutes>=30)
        row['baseline_conditional']=qualified.tail(5).mean()
        if pd.isna(row['baseline_conditional']):
            earlier=pd.concat([old[numeric_cols].astype(float),prior[numeric_cols].astype(float)]);row['baseline_conditional']=earlier.loc[earlier.minutes>=30,'total_points'].mean()
        row['baseline_points']=row['points_mean5']
        row['baseline_minutes']=row['minutes_mean5']
        row['baseline_minutes_last']=sequence.minutes.iloc[-1]
        row['baseline_played']=(sequence.minutes>=30).astype(float).where(sequence.minutes.notna()).tail(5).mean()
        rows.append(row)
    return pd.DataFrame(rows)

def prepare():
    raw=pd.read_parquet(OUT/'input_snapshot.parquet')
    old_meta=pd.read_parquet(OUT/'training_metadata.parquet')
    new_meta=pd.read_parquet(OUT/'test_metadata.parquet')
    train=ev.prepare(raw[raw.season.eq('2025-26')])
    train=train[train.eligible].merge(old_meta,on=['season','gameweek','player_id'],how='inner',validate='one_to_one')
    assert train.gameweek.max()==38
    test=build_test(raw,old_meta,new_meta)
    train.to_parquet(OUT/'train.parquet',index=False)
    test.to_parquet(OUT/'test.parquet',index=False)
    labelled=raw[raw.season.eq('2026-27') & raw.gameweek.le(4)]
    excluded=labelled.merge(test[['player_id','gameweek']],on=['player_id','gameweek'],how='left',indicator=True)
    excluded[excluded._merge.eq('left_only')].drop(columns='_merge').to_csv(OUT/'excluded_no_predeadline_metadata.csv',index=False)
    protocol=dict(train_season='2025-26',training_target_gameweeks=[int(train.gameweek.min()),38],training_rows=len(train),test_season='2026-27',test_gameweeks=[1,2,3,4],test_rows=len(test),features=FEATURES,groups=GROUPS,seed=42,
      fit='Fit each of the three estimators once on 2025-26 only. No tuning, refitting or calibration on 2026-27.',
      history='Stable player codes link seasons. Recent features use the previous five calendar rounds, crossing the summer. Current-season cumulative totals reset to zero. Current-season historical mean is missing before GW1. GW2-4 use only completed earlier rounds.',
      cold_start='Include predeadline-listed players with recorded outcomes even without five prior rows. Missing model inputs use training-only medians. Baselines fall back to training target means, with conditional mean from >=30-minute training rows.',
      cohort='Intersection of archived predeadline players and observed outcome rows. Missing outcomes are not filled with zero. New arrivals/returners and complete/incomplete history are reported separately.',
      statistics='Four gameweeks only. Report paired per-week differences and their mean/range. No reliable season-wide significance claim or reuse of 15-week block-bootstrap intervals.',
      limitations=['Retrospective cross-season test, not a prospective deployment.', 'Early-season cumulative-feature distribution differs from GW6-38 training.', 'Previous-season recent form can be stale after summer/team changes.', 'Upcoming fixtures and opponent effects remain excluded.', 'Overall points retain the existing conditional-points times P(minutes>=30) construction; short appearances can still score points.'],
      input_sha256=hashlib.sha256((OUT/'input_snapshot.parquet').read_bytes()).hexdigest())
    save_json(OUT/'protocol.json',protocol)
    print('Prepared',len(train),'train;',len(test),'test;',len(labelled)-len(test),'excluded',flush=True)

def run():
    import joblib
    train=pd.read_parquet(OUT/'train.parquet');test=pd.read_parquet(OUT/'test.parquet')
    configs=[('full',FEATURES),('reduced',ev.FEATURES)]+[('without_'+name,[f for f in FEATURES if f not in group]) for name,group in GROUPS.items()]
    (OUT/'models').mkdir(exist_ok=True)
    for name,features in configs:
        start=time.time();d=test.copy();fitted={}
        for task,model in ev.models().items():
            fit=train[train.actual_played.eq(1)] if task=='conditional_points' else train
            target={'conditional_points':'actual_points','participation':'actual_played','minutes':'actual_minutes'}[task]
            model.fit(fit[features],fit[target]);fitted[task]=model
            p=model.predict_proba(test[features])[:,1] if task=='participation' else model.predict(test[features])
            d[task]=np.clip(p,0,1) if task=='participation' else np.maximum(p,0)
        d['overall_points']=d.conditional_points*d.participation
        for col,target in [('baseline_points','actual_points'),('baseline_minutes','actual_minutes'),('baseline_minutes_last','actual_minutes'),('baseline_played','actual_played')]:
            d[col]=d[col].fillna(train[target].mean())
        d['baseline_conditional']=d.baseline_conditional.fillna(train.loc[train.actual_played.eq(1),'actual_points'].mean())
        d.to_parquet(OUT/f'{name}_predictions.parquet',index=False)
        joblib.dump(dict(features=features,estimators=fitted),OUT/'models'/f'{name}.joblib')
        print(name,'complete',round(time.time()-start,1),'seconds',flush=True)
    for p in [Path(__file__),Path(ev.__file__)]:shutil.copy2(p,OUT/p.name)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('stage',choices=['acquire','prepare','run']);args=parser.parse_args()
    globals()[args.stage]()
