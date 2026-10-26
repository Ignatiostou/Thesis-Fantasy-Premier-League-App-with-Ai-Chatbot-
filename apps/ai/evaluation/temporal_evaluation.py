"""Retrospective, season-local evaluation using prior player outcomes only.

This is a separate historical feature configuration, not the production pipeline.
No database access, saved-model replacement, or production configuration changes.
"""
from pathlib import Path
import argparse
import hashlib
import json
import platform
import shutil
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error, mean_squared_error, brier_score_loss, log_loss, f1_score
from xgboost import XGBClassifier, XGBRegressor

ROLLING = {
    'total_points': [('points_last1', 1), ('points_mean3', 3), ('points_mean5', 5)],
    'minutes': [('minutes_mean3', 3), ('minutes_mean5', 5)],
    'ict_index': [('ict_mean5', 5)],
    'threat': [('threat_mean5', 5)],
    'creativity': [('creativity_mean5', 5)],
    'influence': [('influence_mean5', 5)],
}
CUMULATIVE = ['total_points', 'goals_scored', 'assists', 'clean_sheets', 'bonus']
FEATURES = [name for specs in ROLLING.values() for name, _ in specs] + ['points_std5'] + [f'{c}_sum' for c in CUMULATIVE] + ['points_mean_history']
EXCLUDED = ['form', 'now_cost', 'selected_by_percent', 'status', 'chance_of_playing', 'position', 'team_id', 'opponent_team_id', 'fixture_fdr', 'next_gw_fdr', 'avg_fdr_next3', 'is_home_next_gw', 'team features', 'opponent features']


def prepare(raw, min_history=5):
    """Each row predicts its own GW, using strictly earlier same-season rows.

    Reindex to calendar gameweeks so absent records break the five-round window.
    Absent outcomes remain missing, never silently become zero/nonparticipation.
    """
    required = set(['season', 'player_id', 'gameweek', 'minutes'] + CUMULATIVE + list(ROLLING))
    missing = required - set(raw)
    if missing:
        raise ValueError(f'Missing columns: {sorted(missing)}')
    keys = ['season', 'player_id', 'gameweek']
    if raw.duplicated(keys).any():
        raise ValueError('Duplicate season/player/gameweek keys')
    if not raw.gameweek.between(1, 38).all():
        raise ValueError('Invalid gameweek')
    frames = []
    for (season, player), group in raw.groupby(['season', 'player_id'], sort=True):
        g = group.sort_values('gameweek').set_index('gameweek').reindex(range(1, 39))
        f = pd.DataFrame(index=g.index)
        f['season'], f['player_id'], f['gameweek'] = season, player, g.index
        f['round_key'] = int(str(season).split('-')[0]) * 100 + g.index
        complete = g.total_points.notna() & g.minutes.notna()
        # Require a complete contiguous history, as well as a labelled target.
        f['eligible'] = complete & complete.shift(1).rolling(min_history, min_periods=min_history).sum().eq(min_history)
        f['actual_points'], f['actual_minutes'] = g.total_points, g.minutes
        played = (g.minutes >= 30).astype(float).where(g.minutes.notna())
        f['actual_played'] = played
        for source, specs in ROLLING.items():
            past = pd.to_numeric(g[source], errors='raise').shift(1)
            for name, window in specs:
                f[name] = past.rolling(window, min_periods=1).mean()
        f['points_std5'] = g.total_points.shift(1).rolling(5, min_periods=2).std()
        for col in CUMULATIVE:
            f[f'{col}_sum'] = g[col].shift(1).expanding(min_periods=1).sum()
        f['points_mean_history'] = g.total_points.shift(1).expanding(min_periods=1).mean()
        conditional = g.total_points.where(g.minutes >= 30).shift(1)
        f['baseline_conditional'] = conditional.rolling(5, min_periods=1).mean().fillna(conditional.expanding(min_periods=1).mean())
        f['baseline_points'] = f.points_mean5
        f['baseline_minutes'] = f.minutes_mean5
        f['baseline_minutes_last'] = g.minutes.shift(1)
        f['baseline_played'] = played.shift(1).rolling(5, min_periods=1).mean()
        # Diagnostic only: minutes >90 identifies some, not all, double GWs.
        f['observed_minutes_above90'] = g.minutes > 90
        frames.append(f.reset_index(drop=True))
    return pd.concat(frames, ignore_index=True).sort_values(['round_key', 'player_id']).reset_index(drop=True)


def split_fold(frame, season, target_gw):
    local = frame[(frame.season == season) & frame.eligible]
    key = int(season.split('-')[0]) * 100 + target_gw
    train, test = local[local.round_key < key].copy(), local[local.round_key == key].copy()
    if len(train) < 100 or len(test) < 20:
        raise ValueError(f'Insufficient fold size: {len(train)} train, {len(test)} test')
    assert train.round_key.max() < test.round_key.min()
    return train, test


def models():
    common = dict(n_estimators=400, max_depth=4, learning_rate=.05, subsample=.8,
                  colsample_bytree=.8, min_child_weight=5, reg_alpha=.1,
                  reg_lambda=1., random_state=42, n_jobs=2, verbosity=0)
    def pipe(model):
        return Pipeline([('imputer', SimpleImputer(strategy='median')), ('model', model)])
    return {
        'conditional_points': pipe(GradientBoostingRegressor(n_estimators=250, learning_rate=.04, max_depth=3, random_state=42)),
        'participation': pipe(XGBClassifier(**common, objective='binary:logistic', eval_metric='auc')),
        'minutes': pipe(XGBRegressor(**common, objective='reg:squarederror')),
    }


def regression(y, pred):
    return dict(n=len(y), mae=float(mean_absolute_error(y, pred)), rmse=float(np.sqrt(mean_squared_error(y, pred))), signed_error=float(np.mean(pred-y)))


def probability(y, p):
    return dict(n=len(y), brier=float(brier_score_loss(y, p)), log_loss=float(log_loss(y, np.clip(p, 1e-6, 1-1e-6), labels=[0, 1])), f1=float(f1_score(y, p >= .5, zero_division=0)))


def evaluate_fold(frame, season, target_gw):
    train, test = split_fold(frame, season, target_gw)
    output = test[['season', 'player_id', 'gameweek', 'round_key', 'actual_points', 'actual_minutes', 'actual_played', 'observed_minutes_above90', 'baseline_points', 'baseline_conditional', 'baseline_minutes', 'baseline_minutes_last', 'baseline_played']].copy()
    selected = models()
    elapsed = {}
    for name, model in selected.items():
        fit = train[train.actual_played == 1] if name == 'conditional_points' else train
        target = {'conditional_points':'actual_points', 'participation':'actual_played', 'minutes':'actual_minutes'}[name]
        if name == 'participation' and fit[target].nunique() != 2:
            raise ValueError('Participation training requires both classes')
        begin = time.perf_counter()
        model.fit(fit[FEATURES], fit[target])
        predictions = model.predict_proba(test[FEATURES])[:, 1] if name == 'participation' else model.predict(test[FEATURES])
        output[name] = np.clip(predictions, 0, 1) if name == 'participation' else np.maximum(predictions, 0)
        elapsed[name] = time.perf_counter()-begin
    # Training-only fallback for players with no prior qualifying appearance.
    fallback = float(train.loc[train.actual_played == 1, 'actual_points'].mean())
    output['baseline_conditional'] = output.baseline_conditional.fillna(fallback)
    output['overall_points'] = output.conditional_points * output.participation
    conditional = output.actual_played == 1
    comparisons = {}
    for name, target, model_col, baseline_col, mask in [
        ('conditional_points','actual_points','conditional_points','baseline_conditional',conditional),
        ('overall_points','actual_points','overall_points','baseline_points',np.ones(len(output),dtype=bool)),
        ('minutes','actual_minutes','minutes','baseline_minutes',np.ones(len(output),dtype=bool))]:
        subset = output.loc[mask]
        comparisons[name] = {'model':regression(subset[target], subset[model_col]), 'baseline':regression(subset[target], subset[baseline_col])}
    comparisons['minutes_last_baseline'] = regression(output.actual_minutes, output.baseline_minutes_last)
    comparisons['participation'] = {'model':probability(output.actual_played, output.participation), 'baseline':probability(output.actual_played, output.baseline_played)}
    return output, {'season':season, 'target_gameweek':target_gw, 'training_rows':len(train), 'conditional_training_rows':int((train.actual_played==1).sum()), 'training_target_gameweeks':[int(train.gameweek.min()), int(train.gameweek.max())], 'timing_seconds':elapsed, 'metrics':comparisons, 'observed_over90_cases':int(output.observed_minutes_above90.sum())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, default=Path(__file__).resolve().parents[1]/'artifacts/datasets/player_gw_history.parquet')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--season', default='2025-26')
    parser.add_argument('--start-gw', type=int, default=21)
    parser.add_argument('--end-gw', type=int, default=21)
    args = parser.parse_args()
    if not 6 <= args.start_gw <= args.end_gw <= 38:
        parser.error('Require 6 <= start-gw <= end-gw <= 38')
    # A new directory for every run prevents accidental replacement of results.
    args.output.mkdir(parents=True, exist_ok=False)
    snapshot = args.output/'input_snapshot.parquet'
    shutil.copy2(args.data, snapshot)
    begin = time.perf_counter()
    frame = prepare(pd.read_parquet(snapshot))
    frame.to_parquet(args.output/'prepared.parquet', index=False)
    reports, predictions = [], []
    for gw in range(args.start_gw, args.end_gw+1):
        result, report = evaluate_fold(frame, args.season, gw)
        predictions.append(result);reports.append(report)
        print(json.dumps(report), flush=True)
    pd.concat(predictions).to_csv(args.output/'predictions.csv',index=False)
    import sklearn, xgboost
    manifest = {'experiment':'historical_player_only_v1','status':'retrospective development evaluation; not untouched holdout or production-feature performance', 'features':FEATURES,'excluded_features':EXCLUDED,'min_consecutive_history':5,'season':args.season,'folds':reports,'elapsed_seconds':time.perf_counter()-begin,'data_sha256':hashlib.sha256(snapshot.read_bytes()).hexdigest(),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'versions':{'python':platform.python_version(),'pandas':pd.__version__,'numpy':np.__version__,'sklearn':sklearn.__version__,'xgboost':xgboost.__version__},'model_parameters':{k:v.named_steps['model'].get_params() for k,v in models().items()},'limitations':['Prior round is assumed completed before target deadline; fixture timestamps not validated.','Player coverage is conditional on appearing in saved history; absent players are not reconstructed.','Fixture/price/ownership/team context excluded rather than guessed.','Double gameweeks remain aggregate targets; no 90-minute upper clip. Over90 subgroup is incomplete identification.','No estimator selection or tuning on test folds. Architectures fixed from existing code, already informed by historical data.']}
    (args.output/'report.json').write_text(json.dumps(manifest,indent=2))

if __name__ == '__main__':
    main()
