"""
Generates predictions for a gameweek with the current model and stores them
in player_predictions — no retraining.

    python scripts/predict_next_gameweek.py --gameweek 25
    python scripts/predict_next_gameweek.py            # auto: next unfinished GW

Equivalent to `python pipeline.py --predict-only` but with an explicit
target gameweek.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from logging_utils import get_logger

logger = get_logger("predict_next_gameweek")


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict player points for a gameweek")
    parser.add_argument("--gameweek", type=int, default=None,
                        help="Target gameweek to predict (default: latest finished GW + 1)")
    args = parser.parse_args()

    from pipeline import resolve_target_gameweek, stage_predict, stage_upsert
    from db import dispose

    try:
        if args.gameweek is not None:
            target_gw = args.gameweek
        else:
            target_gw = resolve_target_gameweek(None)
            if target_gw is None:
                logger.info("No upcoming gameweek to predict — season complete.")
                return

        stage_predict(target_gw, provisional=True)
        stage_upsert(target_gw)
        logger.info("Predictions for GW%d stored.", target_gw)
    finally:
        dispose()


if __name__ == "__main__":
    main()
