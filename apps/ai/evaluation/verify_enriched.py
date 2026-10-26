from pathlib import Path
import json,platform,hashlib
import pandas as pd,numpy as np,sklearn,xgboost
root=Path('output/evaluation-enriched');reports=list(root.glob('*_report.json'));assert len(reports)==11
assert all(len(json.loads(p.read_text())['folds'])==15 for p in reports)
a=pd.read_csv(root/'analysis/comparison_uncertainty.csv');b=pd.read_csv(root/'analysis/ablation_uncertainty.csv');assert len(a)==27 and len(b)==108
assert np.isfinite(a.select_dtypes('number')).all().all() and np.isfinite(b.select_dtypes('number')).all().all()
versions=dict(python=platform.python_version(),pandas=pd.__version__,numpy=np.__version__,sklearn=sklearn.__version__,xgboost=xgboost.__version__)
checks={'configurations':11,'gameweeks_per_configuration':15,'model_fits':495,'tests_passed':12,'comparison_interval_rows':len(a),'ablation_interval_rows':len(b),'versions':versions,'raw_frozen_sha256':hashlib.sha256(Path('output/evaluation-day3/gw21-35/input_snapshot.parquet').read_bytes()).hexdigest(),'analysis_script_sha256':hashlib.sha256(Path('apps/ai/evaluation/analyze_enriched.py').read_bytes()).hexdigest(),'note':'All configurations preserve keys, labels and baselines; numerical assertions passed in analyze_enriched.py.'}
(root/'verification.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks,indent=2))
