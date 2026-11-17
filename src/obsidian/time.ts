import { moment } from 'obsidian';

/**
 * Typed wrapper around Obsidian's bundled moment. Depending on how `moment` types resolve,
 * the export can be seen as `any`; going through this narrow interface keeps call sites
 * free of typescript-eslint no-unsafe-* findings.
 */
interface MomentLike {
	isValid(): boolean;
	format(fmt: string): string;
}
type MomentFn = (input?: string, format?: string, strict?: boolean) => MomentLike;

const m = moment as unknown as MomentFn;

/** Today's local date as YYYY-MM-DD. */
export function todayKey(): string {
	return m().format('YYYY-MM-DD');
}

/** Strictly parse `text` with a moment format; returns YYYY-MM-DD or null. */
export function parseStrictDate(text: string, format: string): string | null {
	const d = m(text, format, true);
	return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

/** Format a YYYY-MM-DD day with a moment format (e.g. "dddd, LL" or a daily-note format). */
export function formatDay(day: string, format: string): string {
	return m(day, 'YYYY-MM-DD', true).format(format);
}

/** Current local time as HH:mm (daily-note template {{time}}). */
export function nowTime(): string {
	return m().format('HH:mm');
}
