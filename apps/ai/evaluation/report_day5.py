"""Render the recorded TypeScript scoring experiment; no model fitting."""
from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output/evaluation-day5'
r = json.loads((OUT / 'controlled-results.json').read_text())
plt.rcParams.update({'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False})
fig, ax = plt.subplots(figsize=(8, 4.5))
for i, label in enumerate(['Cautious', 'Balanced', 'Aggressive']):
    ax.plot([x['probability'] for x in r['riskSweep']], [x['scores'][i] for x in r['riskSweep']], label=label)
ax.set(xlabel='Participation probability (other inputs held fixed)', ylabel='Ranking score', title='Effect of risk preference on shared ranking')
ax.legend(); fig.tight_layout(); fig.savefig(OUT / '01_risk_sensitivity.png', dpi=180); plt.close(fig)
fig, ax = plt.subplots(figsize=(8, 4.5))
for pid, label in [(1, 'Stronger immediate forecast'), (2, 'Stronger longer-horizon forecast')]:
    ax.plot(['Short', 'Balanced', 'Long'], [next(p['score'] for p in x['ranked'] if p['id'] == pid) for x in r['horizon']], marker='o', label=label)
ax.set(xlabel='Planning preference', ylabel='Ranking score', title='A controlled change in player ranking')
ax.legend(); fig.tight_layout(); fig.savefig(OUT / '02_horizon_rank_change.png', dpi=180); plt.close(fig)
negative = r['negativeTransfer']['candidates'][0]
risk80 = r['riskSweep'][80]['scores']
report = f'''# Day 5 — scoring-system evaluation

## What was completed

We evaluated the weekly shared ranking, profile-to-weight mapping, team/opponent multiplier, captaincy scoring and ML transfer scoring. These checks call the actual TypeScript functions with controlled inputs. They do not use an LLM or a live database. No production formula or trained model was changed.

Nine new evaluation tests and 54 existing related tests passed (63 in total, four files). The new evaluation covers all {r['profileCombinations']:,} valid combinations of the ten three-choice profile fields, 101 participation settings, 303 changes to individual point forecasts and 1,200 team-context combinations. These are controlled cases, not independent users or historical matches. Passing a test that records an unexpected behaviour does not establish that the behaviour is desirable.

## Which score are we evaluating?

The ML experiment already evaluated conditional points multiplied by the probability of playing at least 30 minutes. This is the app's risk-adjusted one-week forecast, called overall points in the evaluation. Its pooled MAE was 0.902 against 1.035 for the baseline; in the retrospectively selected top-player group it was 2.956 against 3.285. The missing contribution from appearances shorter than 30 minutes remains a limitation.

Weekly recommendation scores then combine one-, three- and five-week forecasts with additional availability, confidence and preference adjustments. These scores are ranking utilities. An MAE between a ranking score and actual FPL points would not evaluate the intended quantity. We therefore evaluated their direction, boundaries, rank changes and selection rules.

## Formula checks and sensitivity

| Component | Controlled result | Meaning |
|---|---|---|
| Profile mapping | All 59,049 valid profiles produced finite weights and scores; horizon weights summed to one | The defined questionnaire choices map to usable numerical settings |
| Worked example | Forecasts 4/12/19, probability 0.8, sixty-minute factor 0.7 and HIGH confidence gave 5.086 | Matches the Chapter 6 example before team and ownership adjustments |
| Confidence | LOW/MEDIUM/HIGH scores: {r['confidenceScores'][0]:.3f}/{r['confidenceScores'][1]:.3f}/{r['confidenceScores'][2]:.3f} | Higher confidence increases ranking, with other inputs unchanged |
| Risk preference | At probability 0.8: cautious {risk80[0]:.3f}, balanced {risk80[1]:.3f}, aggressive {risk80[2]:.3f} | Cautious profiles penalise uncertain participation more |
| Predicted points | No decreasing score in 303 single-horizon changes | Increasing a forecast did not reduce the score in this grid |
| Team context | All 1,200 multipliers stayed between 0.70 and 1.35 | The tested context adjustments respected their bounds |
| Repeatability | Identical inputs produced identical outputs without changing the input array | These scoring paths are deterministic |

![Risk sensitivity](01_risk_sensitivity.png)

The participation floor makes the score flat below probability 0.15 when point forecasts are held fixed. This figure isolates the scoring multiplier; in a full pipeline the risk-adjusted forecast would also change with participation probability.

![Planning horizon changes](02_horizon_rank_change.png)

The first controlled player had forecasts of 8, 12 and 15 points, while the second had 4, 16 and 30. The short-term setting ranked the first player higher; the long-term setting ranked the second higher. This demonstrates that the preference can change the decision. It does not show that the chosen coefficients are optimal. Longer forecasts are totals over different periods, so the weight percentages are not equal-scale contributions.

## Findings that need attention

1. **Transfers can have a negative final score.** A controlled outgoing player had forecasts of 8/12/20 and an incoming player had 1/13/14. The three-week gain was +1, so the candidate passed the gate, but the short-term transfer score was {negative['transferScore']:.3f}. The service still returned it. A positive three-week gain is therefore not the same as a positive personalised score. A later change should either require positive final utility or explain this trade-off explicitly.
2. **The transfer gate always uses three weeks.** A candidate improving one- and five-week forecasts can be rejected if its three-week gain is non-positive. The preliminary shortlist also uses three-week forecasts. This restricts the effect of the horizon preference before scoring begins.
3. **Transfer frequency did not change this service's result.** The profile produces a hit-tolerance coefficient, but this ML scoring path does not use it. Testing the separate transfer-cost/execution path is necessary before drawing a conclusion about the whole app.
4. **Captain safety takes precedence over the numerical score.** A non-high-risk candidate was selected ahead of a higher-scoring high-risk candidate. The bold profile can increase a high-risk score, but it does not remove this selection gate. For a high-risk candidate, its risk multiplier is 0.75/0.7 = 1.071 under the bold setting: a small boost rather than a penalty.
5. **Ownership can add a score when all point forecasts are zero.** With zero ownership and the strongest differential preference, the additive floor produced a score of {r['zeroForecastWithDifferential']['rankingScore']:.3f}. This does not establish that such a player reaches the final recommendation: other services apply eligibility filters. It is a boundary case to cover in integration testing.
6. **Missing ownership has two behaviours.** With no ownership map, the example scored {r['missingOwnership']['absentMap']:.3f}; with an empty map, it scored {r['missingOwnership']['emptyMap']:.3f}, because a missing player defaults to 50% ownership. The missing-data policy should be made consistent or documented.
7. **Fixture context is not the same as the stored FDR value.** Changing only FDR from 2 to 5 did not affect the multiplier in the checked cases. The function uses team/opponent statistics and home advantage. It accepts only one next fixture per team, so this test does not validate blank- or double-gameweek handling.
8. **Equal rounded scores preserve input order.** Repeatability therefore requires candidate order as well as identical values. A secondary player-ID sort would provide an explicit tie-break if that behaviour is desired.

The shared ranking applies availability again even though forecast points already include participation risk. This can be an intentional preference for reliability, but it should not be described as another expected-points estimate. The source also defines a defender-style coefficient that is not consumed by the inspected weekly ranking path.

## Limits and conclusion

The scoring functions behaved consistently across the controlled grids, and the risk and horizon preferences changed scores in the intended directions. The experiment also identified selection rules and missing-data cases that need explicit treatment. It did not establish that personalised rankings earn more FPL points than ranking by expected points alone.

Day 5's controlled weekly-scoring evaluation is complete. Historical recommendation effectiveness, budget and club constraints, transfer penalties, squad optimisation, chip planning and technical chatbot correctness remain separate evaluations. The outstanding deadline-safe fixture data also prevents claiming a complete historical replay of production scoring. The team-index database builder was not executed or validated here. No previously reported fixture limitation has been silently marked resolved.

The next stage should evaluate recommendations end to end: compare the same eligible candidate pools, record every filter, check feasibility and transfer costs, and compare selected players with an expected-points-only baseline. The negative-transfer and horizon-gate cases above should be included explicitly. Any changes should be recorded as a new scoring version before comparing outcomes.

## Reproduction and evidence

From `apps/api`, run `node ../../node_modules/vitest/vitest.mjs run src/modules/assistant/__tests__/day5-scoring.evaluation.test.ts src/modules/assistant/__tests__/player-ranking.service.test.ts src/modules/assistant/__tests__/ml-captaincy.service.test.ts src/modules/assistant/__tests__/ml-transfer.recommendation.service.test.ts`.

Then run `apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/report_day5.py` from the repository root. The machine-readable results and hashes of the five evaluated source files are in `controlled-results.json`. The experiment uses synthetic examples; their scores must not be presented as observed player outcomes.
'''
(OUT / 'Day-5-Results.md').write_text(report, encoding='utf-8')
print(f'Wrote {OUT / "Day-5-Results.md"} and two figures')
