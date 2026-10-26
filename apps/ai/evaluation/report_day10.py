"""Summarise saved chatbot diagnostics; no model calls or production changes."""
import hashlib
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output/evaluation-day10'
rows = json.loads((OUT / 'routing.json').read_text(encoding='utf-8'))['rows']
direct = [r for r in rows if r['category'] not in ('offtopic', 'followup')]
off = [r for r in rows if r['category'] == 'offtopic']
follow = [r for r in rows if r['category'] == 'followup']
correct = sum(r['intent'] == r['expectedIntent'] for r in direct)
metrics = {'direct_intent_correct': correct, 'direct_total': len(direct),
           'direct_scope_accepted': sum(r['scope'] for r in direct),
           'offtopic_rejected': sum(not r['scope'] for r in off), 'offtopic_total': len(off),
           'followups_accepted': sum(r['scope'] for r in follow), 'followup_total': len(follow)}
(OUT / 'metrics.json').write_text(json.dumps(metrics, indent=2))
fig, ax = plt.subplots(figsize=(9, 4.5))
values = [correct / len(direct), sum(not r['scope'] for r in off) / len(off), sum(r['scope'] for r in follow) / len(follow)]
bars = ax.bar(['Direct intent\n(correct route)', 'Off-topic\n(correctly rejected)', 'Contextual follow-up\n(accepted by keyword gate)'], values, color=['#2876ad', '#b57620', '#b54848'])
for b, v, n in zip(bars, values, [len(direct), len(off), len(follow)]):
    ax.text(b.get_x()+b.get_width()/2, v+.025, f'{round(v*n)}/{n}', ha='center')
ax.set_ylim(0, 1.15)
ax.set_ylabel('Fraction of diagnostic cases')
ax.set_title('Chatbot routing diagnostics — author-labelled synthetic cases')
fig.tight_layout()
fig.savefig(OUT / '01-routing-diagnostics.png', dpi=180)
plt.close(fig)
errors = '\n'.join(f"| {r['message']} | {r['expectedIntent']} | {r['intent']} |" for r in direct if r['intent'] != r['expectedIntent'])
report = f'''# Day 10: technical chatbot evaluation

## What was evaluated

We evaluated the chatbot's request classification, scope filtering, conversation history and existing request/provider/prompt tests. We used the actual TypeScript functions with synthetic inputs. Database and provider dependencies in unit tests were mocked; no real participant messages were used.

The new corpus contains 34 deliberately selected cases: 24 direct FPL requests, six unrelated requests and four follow-ups that assume an earlier FPL exchange. Expected labels were set before running this corpus. It was written with knowledge of the implementation and is a diagnostic set, not an independent benchmark or a representative sample of user traffic. The four follow-ups require conversational context and are excluded from direct-intent accuracy.

## Results

| Check | Result | Meaning |
|---|---:|---|
| Direct FPL intent classification | {correct}/24 ({100*correct/24:.1f}%) | Match to author-assigned intended task |
| Direct FPL requests accepted by keyword scope gate | {metrics['direct_scope_accepted']}/24 | Does not prove the subsequent answer is correct |
| Unrelated requests rejected by keyword scope gate | {metrics['offtopic_rejected']}/6 | Generic terms can admit unrelated requests |
| Contextual follow-ups accepted by keyword scope gate | {metrics['followups_accepted']}/4 | Gate receives the current message without history |
| Messages returned for a 25-message conversation | 20 | The first 20, rather than the most recent 20 |
| Latest message present in that history | No | The current question can be missing from the LLM input |

![Routing diagnostics](01-routing-diagnostics.png)

The figure presents counts on this small corpus. These percentages should not be generalised to all conversations.

### Direct routing mismatches

| Request | Intended task | Actual route |
|---|---|---|
{errors}

### Scope filtering

Requests about comparing laptops, buying a bicycle, transferring files and improving a credit score pass the keyword gate. This does not establish that the model answers them: the prompt can still refuse them. It establishes that deterministic rejection before generation is incomplete.

All four short follow-ups fail the keyword gate. The service next searches for a mentioned player. For a follow-up without a recognised player name, it returns the out-of-scope reply before reading conversation history. Therefore, an otherwise useful exchange can be interrupted by a natural follow-up such as “Why that one?” The player-search database fallback was not exercised in the pure classifier corpus.

### Conversation history

The production getRecentHistory function requests messages in ascending creation order with take=20. A database mock reproducing that ordering returned turn-1 through turn-20 from a 25-message transcript. Turn-25 was absent. The service saves the current message and then uses this function when constructing the generation request, so the omission matters after the history limit. This is a function-level reproduction with a simulated database, not a browser session or a real-database integration test.

### Prompt and existing tests

Eight test files passed, containing 193 tests: 191 existing tests and two new diagnostics. They cover intent handling, service orchestration, session memory, controller behaviour, provider adapters and prompt construction/personalisation. Passing these tests means their assertions hold; it does not demonstrate factual accuracy of live answers. The new history test deliberately records an undesirable behaviour and must not be described as a successful memory acceptance test.

The prompt explicitly asks for grounded numbers, uncertainty, alternatives and manager control. These are useful design mechanisms, but their presence is not proof of compliance by the model. The prompt also repeats the two-free-transfer cap and once-per-season non-Wildcard chip rules identified in Day 9. That creates a source of incorrect official-season guidance even if the model follows its prompt faithfully. The Day 9 report contains the official-rule comparison.

## Live response evaluation: not completed

A separate opt-in harness prepares six synthetic cases covering numerical grounding, one-week versus three-week projections, missing opponent statistics, advice versus executed actions, an unsupported-number instruction and an unrelated request. It uses the production prompt builder and provider adapter, with no real manager data. This bypasses routing and the database, so even a successful run would be a component evaluation rather than a complete application test.

The configured provider was Anthropic and the configured model was claude-sonnet-5. The initial attempts ended with connection errors; no generated answer was obtained. A request for network-enabled execution was rejected by automatic approval review because it would transmit the application's system prompt and synthetic context to the external provider. No workaround was attempted. Live answer correctness, explanation quality, instruction resistance and response latency therefore have no measured results in this stage. A passing harness assertion only means an attempt was recorded.

## Conclusion and next steps

The technical checks reveal working direct routes alongside concrete conversation problems. The clearest priorities are to return the latest history in chronological order and allow contextual follow-ups to be interpreted using the preceding exchange. Scope handling should distinguish FPL requests from generic uses of words such as “buy” or “transfer”. The rule text should be reconciled with the season supported by the application.

No production code was changed. After any correction, rerun this same diagnostic set and the existing tests, adding actual service/database conversation tests. To finish the generated-response part, run the saved six-case protocol with approved provider access, manually compare each answer with its supplied facts, record failures and repeat cases before making reliability claims. Full browser use, streaming under real network failures, and long live conversations remain outside the current evidence.

Day 10 is complete for the bounded offline diagnostic work, but is not complete for live chatbot response evaluation. The thesis and PDF were not changed.

## Reproduction and evidence

Sources: day10-routing.evaluation.test.ts and day10-live.evaluation.test.ts in apps/api/src/modules/assistant/__tests__. Results: routing.json, memory.json, metrics.json and live-responses.json in this directory. The latter records the synthetic prompt and sanitised error only, not an API key. Regenerate this report with apps/ai/.venv/Scripts/python.exe apps/ai/evaluation/report_day10.py.
'''
live_review = OUT / 'Live-review.md'
if live_review.exists():
    start = report.index('## Live response evaluation: not completed')
    end = report.index('## Conclusion and next steps', start)
    report = report[:start] + live_review.read_text(encoding='utf-8') + '\n\n' + report[end:]
    report = report.replace('To finish the generated-response part, run the saved six-case protocol with approved provider access, manually compare each answer with its supplied facts, record failures and repeat cases before making reliability claims.', 'The approved six-case live protocol is now complete and manually reviewed. Repeated cases and independent ratings would be needed before making general reliability claims.')
    report = report.replace('Day 10 is complete for the bounded offline diagnostic work, but is not complete for live chatbot response evaluation.', 'Day 10 is complete for its bounded offline diagnostics and six-case live response check. This does not establish comprehensive chatbot reliability.')
    report = report.replace('The latter records the synthetic prompt and sanitised error only, not an API key.', 'The latter records the synthetic prompt, six real replies, provider usage and stop reasons, but no API key. Live-review.md records the qualitative review. The opt-in live harness also passed and TypeScript checking passed after instrumentation.')
(OUT / 'Day-10-Results.md').write_text(report, encoding='utf-8')
files = [ROOT / 'apps/api/src/modules/assistant' / name for name in ['assistant.intent.service.ts', 'assistant.memory.service.ts', 'assistant.service.ts', 'assistant.llm.service.ts', 'prompt.service.ts']]
files += list((ROOT / 'apps/api/src/modules/assistant/__tests__').glob('day10-*.ts'))
(OUT / 'source-hashes.json').write_text(json.dumps({str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, indent=2))
print(json.dumps(metrics, indent=2))
