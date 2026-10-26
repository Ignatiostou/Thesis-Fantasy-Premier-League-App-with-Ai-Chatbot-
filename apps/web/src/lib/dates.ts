/**
 * Day headings for fixture lists.
 *
 * Shared so the dashboard panel and the full fixtures page label the same day
 * the same way — the two had drifted apart, one showing "Fri 21 Aug" and the
 * other "Friday 21 August", with neither recognising that a date is today.
 *
 * "Today" and "Tomorrow" are worth special-casing: on matchday itself a bare
 * date makes the reader work out whether the games are happening now.
 */

const MS_PER_DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatDayLabel(
  date: Date,
  style: "short" | "long" = "short",
  now: Date = new Date(),
): string {
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / MS_PER_DAY);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";

  return date.toLocaleDateString(
    "en-GB",
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long" }
      : { weekday: "short", day: "numeric", month: "short" },
  );
}
