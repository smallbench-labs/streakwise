/**
 * Turns a frontmatter value into a number for the heatmap.
 *   true / "yes" / "done" / "✅"  -> 1
 *   false / "no" / "" / null      -> 0
 *   12, "12", "1.5h", "30 min"    -> the leading number ("-5" stays negative = not done)
 *   "1,5" -> 1.5 (decimal comma); "1,000" -> 1000 (groups of exactly 3 digits = thousands)
 * Anything else (lists, objects, unrecognised text) -> null, meaning "no data".
 */

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'done', 'x', 'completed', 'complete', 'ok', '✓', '✔', '✔️', '✅']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'skip', 'skipped', 'missed', 'none', '-', '✗', '✘', '❌']);
// Sign is part of the capture so "-5" stays negative (S-03).
const LEADING_NUMBER = /^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))/;
// "1,000" / "12,500.5": comma as thousands separator (S-04). "1,5" stays a decimal comma.
const THOUSANDS = /^([+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?!\d)/;

export function parseHabitValue(raw: unknown): number | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === 'boolean') return raw ? 1 : 0;
	if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
	if (typeof raw !== 'string') return null;

	const text = raw.trim().toLowerCase();
	if (text === '') return 0;
	if (TRUE_WORDS.has(text)) return 1;
	if (FALSE_WORDS.has(text)) return 0;
	const t = THOUSANDS.exec(text);
	if (t) return Number((t[1] ?? '').replace(/,/g, ''));
	const m = LEADING_NUMBER.exec(text);
	if (m) return Number((m[1] ?? '').replace(',', '.'));
	return null;
}

/** Frontmatter keys are matched case-insensitively ("Run", "run", "RUN"). */
export function readHabit(frontmatter: Record<string, unknown> | undefined, habit: string): number | null {
	if (!frontmatter) return null;
	if (habit in frontmatter) return parseHabitValue(frontmatter[habit]);
	const wanted = habit.toLowerCase();
	for (const key of Object.keys(frontmatter)) {
		if (key.toLowerCase() === wanted) return parseHabitValue(frontmatter[key]);
	}
	return null;
}
