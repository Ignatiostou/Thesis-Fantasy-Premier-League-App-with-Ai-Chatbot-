from pathlib import Path
import pandas as pd, numpy as np, json
root=Path('output/evaluation-ml-components');original=pd.read_csv('output/evaluation-day3/gw21-35/predictions.csv')
for p in root.glob('*_predictions.csv'):
 d=pd.read_csv(p)
 for c in ['season','player_id','gameweek','actual_points','actual_minutes','actual_played','baseline_points','baseline_minutes','baseline_minutes_last','baseline_played','baseline_conditional']:
  assert d[c].equals(original[c]),(p,c)
 assert np.isfinite(d.select_dtypes('number')).all().all()
print('All currently completed ablations preserve targets, cases and baselines.')
