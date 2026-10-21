import { App, TFile, TFolder } from 'obsidian';
import { parseStrictDate } from './time';
import { DayKey } from '../core/dates';
import { readHabit } from '../core/values';
import { parseDailyNoteDate } from '../core/noteDates';
import { DailyEntry, DedupedEntries, dedupeByDay, matchDailyNote } from '../core/dailyEntries';

export interface DailySource {
	folder: string;
	format: string;
	origin: 'Periodic Notes' | 'Daily notes (core)' | 'Streakwise settings';
}

export interface SourceSettings {
	sourceMode: 'auto' | 'custom';
	customFolder: string;
	customFormat: string;
}

interface DailyOptions { folder?: string; format?: string }

/** Internal plugin APIs are not in the public typings; read them defensively. */
interface AppInternals {
	plugins?: { getPlugin?(id: string): { settings?: { daily?: DailyOptions & { enabled?: boolean } } } | null };
	internalPlugins?: { getPluginById?(id: string): { enabled?: boolean; instance?: { options?: DailyOptions } } | null };
}

const clean = (folder: string | undefined) => (folder ?? '').trim().replace(/^\/+|\/+$/g, '');

/** Where daily notes live: Periodic Notes, then core Daily notes, then our own settings. */
export function resolveDailySource(app: App, s: SourceSettings): DailySource {
	const fallback: DailySource = {
		folder: clean(s.customFolder), format: s.customFormat.trim() || 'YYYY-MM-DD', origin: 'Streakwise settings',
	};
	if (s.sourceMode === 'custom') return fallback;

	const internals = app as unknown as AppInternals;
	const periodic = internals.plugins?.getPlugin?.('periodic-notes')?.settings?.daily;
	if (periodic?.enabled) {
		return { folder: clean(periodic.folder), format: periodic.format || 'YYYY-MM-DD', origin: 'Periodic Notes' };
	}
	const core = internals.internalPlugins?.getPluginById?.('daily-notes');
	if (core?.enabled) {
		const o = core.instance?.options ?? {};
		return { folder: clean(o.folder), format: o.format || 'YYYY-MM-DD', origin: 'Daily notes (core)' };
	}
	return fallback;
}

/** Date of a note from its path inside the daily-notes folder, or null if it is not a daily note. */
export function dailyNoteDate(path: string, source: DailySource): DayKey | null {
	return matchDailyNote(path, source.folder, (text) => {
		return parseStrictDate(text, source.format) ?? parseDailyNoteDate(text, source.format);
	});
}

/**
 * One vault scan shared by every heatmap block (S-10). Invalidated by the plugin on
 * metadata change, create, delete and rename events, and when settings change.
 */
export class DailyNoteIndex {
	private cached: { key: string; result: DedupedEntries } | null = null;

	constructor(private readonly app: App) {}

	invalidate() {
		this.cached = null;
	}

	get(source: DailySource): DedupedEntries {
		const key = `${source.folder}\n${source.format}`;
		if (this.cached?.key === key) return this.cached.result;
		const entries: DailyEntry[] = [];
		for (const file of markdownFilesIn(this.app, source.folder)) {
			const day = dailyNoteDate(file.path, source);
			if (!day) continue;
			entries.push({ path: file.path, day, frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter });
		}
		const result = dedupeByDay(entries);
		this.cached = { key, result };
		return result;
	}
}

/**
 * Markdown files in the daily-notes folder and its subfolders only (no whole-vault scan).
 * An empty folder setting means the vault root, which is still just that folder tree.
 */
export function markdownFilesIn(app: App, folder: string): TFile[] {
	const start = folder ? app.vault.getAbstractFileByPath(folder) : app.vault.getRoot();
	if (!(start instanceof TFolder)) return [];
	const out: TFile[] = [];
	const stack: TFolder[] = [start];
	let dir: TFolder | undefined;
	while ((dir = stack.pop()) !== undefined) {
		for (const child of dir.children) {
			if (child instanceof TFolder) stack.push(child);
			else if (child instanceof TFile && child.extension === 'md') out.push(child);
		}
	}
	return out;
}

export { isInDailyFolder } from '../core/dailyEntries';

/** habit -> (day -> value) */
export function habitValues(index: DedupedEntries, habits: string[]): Map<string, Map<DayKey, number>> {
	const data = new Map<string, Map<DayKey, number>>(habits.map((h) => [h, new Map()]));
	for (const [day, entry] of index.byDay) {
		for (const habit of habits) {
			const v = readHabit(entry.frontmatter, habit);
			if (v !== null) data.get(habit)?.set(day, v);
		}
	}
	return data;
}
