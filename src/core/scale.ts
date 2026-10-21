/** Maps values to colour levels 0..LEVELS. Level 0 means "nothing / not done". */

export const LEVELS = 4;

/** The value that maps to the darkest colour: explicit `max` if given, else the largest value seen. */
export function scaleMax(values: Iterable<number>, explicitMax?: number): number {
	if (explicitMax !== undefined && explicitMax > 0) return explicitMax;
	let max = 0;
	for (const v of values) if (v > max) max = v;
	return max;
}

export function intensityLevel(value: number | null | undefined, max: number): number {
	if (value === null || value === undefined || value <= 0 || max <= 0) return 0;
	const level = Math.ceil((value / max) * LEVELS);
	return Math.min(LEVELS, Math.max(1, level));
}
