"""Matched confidence comparisons from saved production scoring outputs."""
from pathlib import Path
import json
import shutil
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[3]
out = root / 'output/evaluation-scoring-grid'
data = json.loads((out / 'results.json').read_text())
groups = {}
for row in data['risk']:
    key = (row['trajectory'], row['prob60PlusMins'], row['probability'])
    assert row['confidence'] not in groups.setdefault(key, {})
    groups[key][row['confidence']] = row['scores']
keys = sorted(groups)
scores = np.array([[groups[k][c] for c in ['LOW', 'MEDIUM', 'HIGH']] for k in keys])
assert scores.shape == (19392, 3, 3)
assert np.isfinite(scores).all()
diff = np.diff(scores, axis=1)
assert (diff >= 0).all(), 'Confidence ordering violation'
summary = {'matched_triplets_per_risk_profile': len(keys), 'total_matched_triplets': len(keys)*3,
           'adjacent_comparisons': int(diff.size), 'negative_differences': int((diff<0).sum()),
           'ties': int((diff==0).sum()), 'strict_increases': int((diff>0).sum()),
           'source': 'results.json; existing controlled synthetic grid, no new scoring run'}
(out/'confidence_summary.json').write_text(json.dumps(summary, indent=2))
plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
fig, axes = plt.subplots(1, 3, figsize=(12, 4.6), sharey=True)
for j, (ax, label, color) in enumerate(zip(axes, ['Cautious','Balanced','Aggressive'], ['#2378b8','#da8a23','#42926c'])):
    ax.plot(range(3), scores[:,:,j].T, color=color, alpha=.012, lw=.5, rasterized=True)
    ax.plot(range(3), np.median(scores[:,:,j], axis=0), 'o-', color='black', lw=2, label='Median')
    ax.set(xticks=range(3), xticklabels=['Low','Medium','High'], xlabel='Forecast confidence', title=label)
axes[0].set_ylabel('Recommendation score')
axes[-1].legend()
fig.suptitle('Confidence effect: 19,392 matched input combinations per risk profile')
fig.tight_layout()
path = out/'figures/12_confidence_sensitivity.png'
fig.savefig(path, dpi=180)
plt.close(fig)
shutil.copy2(path, root/'Thesis/chapter-8/figures/recommendations'/path.name)
print(json.dumps(summary, indent=2))
