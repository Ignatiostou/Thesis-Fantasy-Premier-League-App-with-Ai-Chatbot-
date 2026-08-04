# AI Pipeline

This folder contains the offline data/ML pipeline for the Fantasy Premier League AI Coach.

## Phase 6A
- Extract historical player-gameweek data from PostgreSQL
- Build training-ready datasets
- Engineer rolling and lag-based features

## Setup

1. Create a virtual environment
2. Install dependencies
3. Copy `.env.example` to `.env`
4. Run the scripts in order

## Suggested commands

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python data/extract_player_gw_history.py
python data/build_training_dataset.py```

## Automated ML pipeline (Phase 6B)

The pipeline is fully automated end-to-end:

```
End of GW N → FPL marks it finished + data_checked
            → ML scheduler (apps/api, every 15 min) detects it
            → imports GW N results into player_gameweek_stats
            → rebuilds features + retrains models (with rollback gate)
            → predicts GW N+1 → stores in player_predictions
            → chatbot uses the new predictions
```

### One-time historical backfill

Run once at initial setup (downloads every player's per-GW history for the
season the FPL API is serving, trains the models, predicts the next GW):

```bash
.venv/Scripts/python.exe scripts/backfill_season.py --season 2025-26
```

Prerequisite: reference tables synced (`npm run fpl:refresh --workspace @apps/api`).
The API server also triggers this automatically on boot when no trained model
exists (disable with `ML_AUTO_BACKFILL=false`).

### Manual commands

```bash
python pipeline.py --full                    # retrain on all DB data + predict next GW
python pipeline.py --completed-gameweek 24   # GW24 finished → retrain → predict GW25
python pipeline.py --predict-only            # refresh predictions, no retraining
python scripts/update_gameweek.py --gameweek 24 --run-pipeline
python scripts/predict_next_gameweek.py --gameweek 25
```

### Season rollover (before the new season starts)

The stats/prediction tables key by gameweek number without a season column,
so archive + clear them after FPL resets the game in July:

```bash
python scripts/rollover_season.py --season 2025-26          # dry run (archive only)
python scripts/rollover_season.py --season 2025-26 --apply  # archive + clear tables
```

The trained model is kept — the chatbot starts the new season using the model
learned from last season, and the scheduler retrains automatically as soon as
the new season's first gameweek completes.

### Model safety gate

Before each retrain the current artifacts are backed up to
`artifacts/models/_previous/`. If the new points model's validation MAE is
more than 25% worse than the previous one, the previous model is restored.

### Environment knobs (apps/api)

| Variable | Default | Meaning |
|---|---|---|
| `ML_POLL_MINUTES` | `15` | Scheduler check interval |
| `ML_PYTHON` | `apps/ai/.venv` python | Python interpreter to use |
| `ML_AUTO_BACKFILL` | `true` | Auto-run backfill on boot when no model exists |

### Dress rehearsal — test the automation without waiting for a real gameweek

Simulates "GW37 just finished, GW38 not yet predicted" and lets the server
handle it automatically (safe: everything self-heals afterwards):

```bash
# 1. Stage: pretend GW38 is not finalized yet
.venv/Scripts/python.exe -c "from sqlalchemy import text; from db_writer import get_writer_engine, dispose; \
  c = get_writer_engine().begin().__enter__(); \
  c.execute(text(\"UPDATE fpl_events SET raw = jsonb_set(raw::jsonb, '{data_checked}', 'false')::jsonb WHERE id = 38\")); \
  c.execute(text(\"DELETE FROM player_predictions WHERE gameweek = 38 AND model_version NOT LIKE 'backtest%'\")); \
  c.close(); dispose()"

# 2. Start the API server and watch the logs
npm run dev --workspace @apps/api
```

Expected log sequence within ~3 minutes of startup:

```
[ML Scheduler] New completed gameweek detected: GW37 — running pipeline
[ML] Stage 1/5 … Stage 5/5
[ML] Model gate: previous MAE=… | new MAE=…  → New model accepted.
[ML Scheduler] Predictions for GW38 are now available
```

No cleanup needed: the FPL sync restores the real gameweek status on its
first run, and the pipeline regenerates the GW38 predictions itself.
