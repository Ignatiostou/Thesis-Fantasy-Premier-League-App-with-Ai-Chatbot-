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
python data/build_training_dataset.py