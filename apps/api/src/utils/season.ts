/**
 * Current FPL season label, e.g. "2026-27".
 *
 * Derived from the date rather than hard-coded: the literal "2025-26" was baked
 * into both the Prisma default and team creation, so every team created during
 * 2026-27 was stamped with the previous season and the dashboard reported it
 * under the Bank figure.
 *
 * A season is named for the calendar year it starts in, and FPL resets the game
 * in July — so July onward belongs to year/year+1.
 */
export function currentSeason(date: Date = new Date()): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 6 ? year : year - 1; // 6 = July
  const endYear = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYear}`;
}
