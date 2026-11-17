import { DedupedEntries } from './dailyEntries';
import { parseHabitValue } from './values';

/** Frontmatter keys that are never habits. */
const NOT_HABITS = new Set([
	'tags', 'tag', 'aliases', 'alias', 'cssclasses', 'cssclass', 'date', 'day', 'created', 'creation', 'modified', 'updated',
	'title', 'publish', 'permalink', 'id', 'uid', 'type', 'template', 'position', 'week', 'month', 'year', 'banner', 'cover',
]);
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}|^\d{1,2}[:/]\d{2}/;

export interface FoundProperty {
	/** Spelling used in most notes. */
	name: string;
	/** Daily notes where it has a usable value (number, yes/no, done…). */
	notes: number;
}

/**
 * Frontmatter properties in the daily notes that look like habits, most used first.
 * Matching is case-insensitive like readHabit(); dates, times, lists and plain text are skipped.
 */
export function discoverProperties(index: DedupedEntries, limit = 8): FoundProperty[] {
	const counts = new Map<string, { notes: number; present: number; spellings: Map<string, number> }>();
	for (const entry of index.byDay.values()) {
		const fm = entry.frontmatter;
		if (!fm) continue;
		for (const [key, raw] of Object.entries(fm)) {
			const lower = key.toLowerCase();
			if (NOT_HABITS.has(lower)) continue;
			if (typeof raw === 'string' && DATE_LIKE.test(raw.trim())) continue;
			const c = counts.get(lower) ?? { notes: 0, present: 0, spellings: new Map<string, number>() };
			counts.set(lower, c);
			if (raw === null || raw === undefined || raw === '') continue;
			c.present++;
			if (parseHabitValue(raw) === null) continue;
			c.notes++;
			c.spellings.set(key, (c.spellings.get(key) ?? 0) + 1);
		}
	}
	const out: FoundProperty[] = [];
	for (const c of counts.values()) {
		// Mostly free text (e.g. mood: good / tired / ok) is not a habit, even if a few values parse.
		if (c.notes === 0 || c.notes / c.present < 0.6) continue;
		const name = [...c.spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
		if (name) out.push({ name, notes: c.notes });
	}
	out.sort((a, b) => b.notes - a.notes || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
	return out.slice(0, limit);
}

/** Display name for a property: "reading_minutes" -> "Reading minutes", "exercise" -> "Exercise". */
export function habitLabel(name: string): string {
	const spaced = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`).trim();
	return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name;
}

/**
 * Replace one habit name on the habits line of a block source, keeping every other line as written.
 * When the block has no habits line (it used the default habit), one is added at the top.
 */
export function replaceHabitInSource(source: string, from: string, to: string): string {
	const lines = source.split('\n');
	let changed = false;
	const out = lines.map((line) => {
		const m = /^(\s*habits?\s*:\s*)(.*)$/i.exec(line);
		if (!m || changed) return line;
		const names = (m[2] ?? '').split(',').map((h) => h.trim());
		const i = names.findIndex((h) => h.toLowerCase() === from.toLowerCase());
		if (i < 0) return line;
		names[i] = to;
		changed = true;
		return `${m[1] ?? ''}${names.filter(Boolean).join(', ')}`;
	});
	if (changed) return out.join('\n');
	// No habits line (the block used the default habit): add one at the top.
	return [`habits: ${to}`, ...lines].join('\n');
}

/** Replace the rule lines (goal/days/rest/freezes/min) of a block source with `ruleLines`. */
export function setRuleInSource(source: string, ruleLines: string[]): string {
	const kept = source.split('\n').filter((l) => !/^\s*(goal|days|rest|freezes?|min)\s*:/i.test(l));
	while (kept.length && kept[kept.length - 1]?.trim() === '') kept.pop();
	return [...kept, ...ruleLines].join('\n');
}
