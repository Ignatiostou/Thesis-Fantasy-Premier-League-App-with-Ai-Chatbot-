# Historical evaluation runner

This runner is separate from production. It evaluates a fixed player-history-only feature configuration on retrospective saved data. It does not load credentials, contact the database, call a chatbot, overwrite saved models, or modify production feature definitions.

## Protocol

Each row's target is its own gameweek. Inputs use strictly earlier observations for that player in the same season. Reindexing by calendar gameweek prevents an absent record being treated as the next week. Five complete, consecutive earlier rounds are required. Missing target minutes stay missing, not class zero. Training uses target rounds strictly earlier than the evaluated round. Season transitions and cold starts are excluded from this first configuration.

Features: prior points means/std, prior minutes means, prior ICT/threat/creativity/influence means, prior season-to-date points/goals/assists/clean sheets/bonus, and prior average points. 16 features in total. Player identity is not an input.

Excluded: current price, ownership, status and raw form; position metadata; fixture difficulty/horizon and home/away fields; own-team/opponent statistics. Exclusion is deliberate while historical provenance is unresolved. This does not fix the production future-fixture calculation. A future fixture-aware experiment requires verified schedule inputs before correcting/adopting that feature.

Three fixed estimators: gradient boosting for points conditional on >=30 minutes, XGBoost classifier for participation >=30 minutes, and XGBoost regressor for minutes. Hyperparameters and package versions are recorded per run; no model selection/tuning/calibration is performed on test cases. Overall points = conditional points * probability. Negative predicted points/minutes are floored at zero; minutes have no upper 90-minute cap because labels are aggregate gameweek totals.

Baselines: trailing five-round points and minutes means; previous-round minutes; trailing five-round >=30-minute frequency; conditional mean over qualifying appearances in the prior five calendar rounds, falling back to prior same-season qualifying appearances, then the training-fold qualifying mean. Comparisons use identical cases. The log-loss calculation clips probabilities to [1e-6, 1-1e-6], including baseline probabilities of zero and one.

The retrospective corpus already informed development, so this is not an untouched holdout. It assumes prior rounds completed before the target deadline; event timestamps have not established that for every postponed fixture. An observed >90-minute label flags some double-gameweek cases, not all. No claim of performance on the full player population or exact production configuration follows from these results.

## Run from repository root (PowerShell)

```powershell
& apps/ai/.venv/Scripts/python.exe -m pytest apps/ai/tests/test_temporal_evaluation.py -q
& apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/temporal_evaluation.py --output output/evaluation-day2/pilot-gw21 --season 2025-26 --start-gw 21 --end-gw 21
```

Output directory must be new. Each run saves an exact input parquet snapshot, prepared rows, per-player CSV predictions and a JSON report containing counts, model parameters, versions, hashes and timings. The completed pilot occupies the example directory; use a different name for a rerun.

For Day 3, the planned multi-round experiment is:

```powershell
& apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/temporal_evaluation.py --output output/evaluation-day3/gw21-35 --season 2025-26 --start-gw 21 --end-gw 35
```

This command is documented but has not been run as part of Day 2. Report fold-level results and pair comparisons by gameweek. Do not treat the individual player rows as independent replicates when calculating uncertainty.
