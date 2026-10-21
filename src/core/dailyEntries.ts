import { DateRange, DayKey, daysBetween } from './dates';

/** One daily note that matched the configured folder + date format. */
export interface DailyEntry {
	path: string;
	day: DayKey;
	frontmatter: Record<string, unknown> | undefined;
}

export interface DedupedEntries {
	byDay: Map<DayKey, DailyEntry>;
	/** Days that had more than one note; the ignored paths are listed. */
	duplicates: { day: DayKey; used: string; ignored: string[] }[];
}

/**
 * Deterministic rule when several notes map to the same day (S-02):
 * the note with the shortest path wins, ties broken by plain string order.
 * This does not depend on the order Obsidian lists files in.
 */
export function dedupeByDay(entries: DailyEntry[]): DedupedEntries {
	const groups = new Map<DayKey, DailyEntry[]>();
	for (const e of entries) {
		const list = groups.get(e.day);
		if (list) list.push(e); else groups.set(e.day, [e]);
	}
	const byDay = new Map<DayKey, DailyEntry>();
	const duplicates: DedupedEntries['duplicates'] = [];
	for (const [day, list] of groups) {
		list.sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		const [first, ...rest] = list;
		if (!first) continue;
		byDay.set(day, first);
		if (rest.length) duplicates.push({ day, used: first.path, ignored: rest.map((r) => r.path) });
	}
	duplicates.sort((a, b) => (a.day < b.day ? -1 : 1));
	return { byDay, duplicates };
}

/**
 * Path of a note relative to the daily-notes folder, without ".md", or null if it is outside the folder.
 * Notes outside the folder are excluded, so e.g. Archive/2026-10-17.md never counts when the folder is "Daily" (S-02).
 */
export function relativeDailyPath(path: string, folder: string): string | null {
	if (!path.endsWith('.md')) return null;
	const prefix = folder ? folder + '/' : '';
	if (prefix && !path.startsWith(prefix)) return null;
	return path.slice(prefix.length, -3);
}

/**
 * Date of a note inside the daily-notes folder (S-13).
 * 1. The path relative to the folder is matched against the format (supports formats like YYYY/MM/YYYY-MM-DD).
 * 2. Otherwise the file name alone is matched, so notes archived in subfolders
 *    (Daily/2026/2026-10-17.md, or any subfolder when the folder is the vault root) still count.
 * Notes outside the configured folder are never counted (S-02).
 */
export function matchDailyNote(path: string, folder: string, parse: (s: string) => DayKey | null): DayKey | null {
	const relative = relativeDailyPath(path, folder);
	if (relative === null) return null;
	const full = parse(relative);
	if (full) return full;
	const slash = relative.lastIndexOf('/');
	return slash >= 0 ? parse(relative.slice(slash + 1)) : null;
}

/** Only duplicates whose day falls inside the block's visible range are worth mentioning there (S-14). */
export function duplicatesInRange(dups: DedupedEntries['duplicates'], range: DateRange): DedupedEntries['duplicates'] {
	return dups.filter((d) => daysBetween(range.start, d.day) >= 0 && daysBetween(d.day, range.end) >= 0);
}
