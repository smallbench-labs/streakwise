import { DayKey, isValidKey, toKey } from './dates';

/**
 * Reads the date out of a daily note path using a Moment-style format such as
 * "YYYY-MM-DD" or "YYYY/MM/YYYY-MM-DD" (Daily Notes / Periodic Notes setting).
 *
 * Supported tokens: YYYY, YY, MM, M, DD, D, and text tokens (dddd, ddd, MMMM, MMM, Do) which
 * are matched loosely and ignored. Text in [brackets] is literal. Returns null if it does not match.
 *
 * Inside the plugin, Obsidian's bundled moment() is tried first; this parser is the
 * dependency-free fallback and keeps the logic testable.
 */
export function parseDailyNoteDate(pathWithoutExt: string, format: string): DayKey | null {
	const groups: string[] = [];
	let pattern = '';
	const tokenRe = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|./g;
	let m: RegExpExecArray | null;
	while ((m = tokenRe.exec(format)) !== null) {
		const t = m[0];
		if (m[1] !== undefined) { pattern += escape(m[1]); continue; }
		switch (t) {
			case 'YYYY': groups.push('Y'); pattern += '(\\d{4})'; break;
			case 'YY': groups.push('y'); pattern += '(\\d{2})'; break;
			case 'MM': groups.push('M'); pattern += '(\\d{2})'; break;
			case 'M': groups.push('M'); pattern += '(\\d{1,2})'; break;
			case 'DD': groups.push('D'); pattern += '(\\d{2})'; break;
			case 'D': groups.push('D'); pattern += '(\\d{1,2})'; break;
			case 'Do': groups.push('D'); pattern += '(\\d{1,2})(?:st|nd|rd|th)'; break;
			case 'MMMM': case 'MMM': case 'dddd': case 'ddd': pattern += '[^\\d\\s/]+'; break;
			default: pattern += escape(t);
		}
	}
	const match = new RegExp(`^${pattern}$`, 'i').exec(pathWithoutExt);
	if (!match) return null;

	let year = NaN, month = NaN, day = NaN;
	groups.forEach((g, i) => {
		const n = Number(match[i + 1]);
		if (g === 'Y') year = n;
		else if (g === 'y') year = 2000 + n;
		else if (g === 'M') month = n;
		else if (g === 'D') day = n;
	});
	if ([year, month, day].some(Number.isNaN)) return null;
	const key = toKey(year, month, day);
	return isValidKey(key) ? key : null;
}

function escape(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
