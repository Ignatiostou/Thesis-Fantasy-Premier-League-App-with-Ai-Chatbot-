/**
 * Which gameweek should a fixtures list default to?
 *
 * FPL flips `isCurrent` to the *next* gameweek as soon as the last match is
 * data-checked — often that same night, well before the next deadline. If a
 * user opens the fixtures page the morning after, `isCurrent` already points
 * at an empty upcoming gameweek and yesterday's result is one GW back, out of
 * view. The deadline is a much more stable signal: a gameweek stays "in
 * focus" until the *next* one's deadline passes, which is normally most of a
 * week.
 */

interface EventLike {
  id: number;
  deadlineTime: string | null;
  isCurrent: boolean | null;
}

export function defaultFixturesGw<T extends EventLike>(
  events: T[],
  now: Date = new Date(),
): T | null {
  const started = events
    .filter((e) => e.deadlineTime && new Date(e.deadlineTime).getTime() <= now.getTime())
    .sort((a, b) => a.id - b.id);

  if (started.length) return started[started.length - 1];
  return events.find((e) => e.isCurrent) ?? events[0] ?? null;
}
