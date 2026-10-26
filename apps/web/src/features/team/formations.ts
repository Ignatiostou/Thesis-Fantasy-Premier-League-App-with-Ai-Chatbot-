import { TeamPlayer } from "@/lib/types";

/**
 * Legal FPL formations as [DEF, MID, FWD]. One keeper is always in the XI, and
 * the outfield ten must satisfy at least 3 defenders, 2 midfielders and 1
 * forward — the same rule `legalFormation` enforces after a manual swap.
 */
export const FORMATIONS: ReadonlyArray<readonly [number, number, number]> = [
  [3, 4, 3],
  [3, 5, 2],
  [4, 3, 3],
  [4, 4, 2],
  [4, 5, 1],
  [5, 2, 3],
  [5, 3, 2],
  [5, 4, 1],
];

export function formationLabel(f: readonly [number, number, number]): string {
  return f.join("-");
}

/** Current shape of the XI, e.g. "4-4-2". */
export function currentFormation(picks: TeamPlayer[]): string {
  const starters = picks.filter((p) => !p.isOnBench);
  const count = (pos: number) =>
    starters.filter((p) => Number(p.position) === pos).length;
  return `${count(2)}-${count(3)}-${count(4)}`;
}

/**
 * Rebuild the XI to match a formation, disturbing the side as little as
 * possible: players already starting keep their place, and any gaps are filled
 * from the bench in bench order. Whoever drops out joins the bench, reserve
 * keeper first — the position FPL reserves for the substitute goalkeeper.
 */
export function applyFormation(
  picks: TeamPlayer[],
  [def, mid, fwd]: readonly [number, number, number],
): TeamPlayer[] {
  const need: Record<number, number> = { 1: 1, 2: def, 3: mid, 4: fwd };

  // Starters sort ahead of bench; within the bench, existing order is kept.
  const rank = (p: TeamPlayer) =>
    p.isOnBench ? 1000 + (p.benchOrder ?? 0) : 0;

  const startingIds = new Set<number>();
  for (const pos of [1, 2, 3, 4]) {
    picks
      .filter((p) => Number(p.position) === pos)
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, need[pos])
      .forEach((p) => startingIds.add(p.id));
  }

  const dropped = picks.filter((p) => !startingIds.has(p.id));
  const orderedBench = [
    ...dropped.filter((p) => Number(p.position) === 1),
    ...dropped
      .filter((p) => Number(p.position) !== 1)
      .sort((a, b) => rank(a) - rank(b)),
  ];
  const benchSlot = new Map(orderedBench.map((p, i) => [p.id, i]));

  let next = picks.map((p) => ({
    ...p,
    isOnBench: !startingIds.has(p.id),
    benchOrder: startingIds.has(p.id) ? null : (benchSlot.get(p.id) ?? 0),
  }));

  // The armband cannot sit on the bench. Promote the vice if he is still in the
  // XI, otherwise the highest-scoring starter.
  const capBenched = next.some((p) => p.isCaptain && p.isOnBench);
  if (capBenched) {
    const starters = next.filter((p) => !p.isOnBench);
    const vice = starters.find((p) => p.isViceCaptain);
    const heir =
      vice ??
      [...starters].sort(
        (a, b) => (b.eventPoints ?? 0) - (a.eventPoints ?? 0),
      )[0];
    if (heir) {
      next = next.map((p) => ({
        ...p,
        isCaptain: p.id === heir.id,
        isViceCaptain: p.id === heir.id ? false : p.isViceCaptain,
      }));
    }
  }

  const viceBenched = next.some((p) => p.isViceCaptain && p.isOnBench);
  if (viceBenched) {
    const heir = next.find((p) => !p.isOnBench && !p.isCaptain);
    if (heir) {
      next = next.map((p) => ({ ...p, isViceCaptain: p.id === heir.id }));
    }
  }

  return next;
}
