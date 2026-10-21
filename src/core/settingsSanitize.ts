import { PALETTES, Palette } from './blockConfig';
import { WeekStart } from './dates';

/** Plain (non-license) settings as stored in data.json. */
export interface PlainSettings {
	sourceMode: 'auto' | 'custom';
	customFolder: string;
	customFormat: string;
	defaultHabit: string;
	weekStart: WeekStart;
	palette: Palette;
	exportFolder: string;
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/**
 * S-25: data.json can be hand-edited or written by another version.
 * Coerce what is unambiguous ("1" -> 1, "Blue" -> "blue"), otherwise fall back to the default,
 * so a bad value never leaves blocks blank.
 */
export function sanitizeSettings(raw: Record<string, unknown>, defaults: PlainSettings): PlainSettings {
	const ws = typeof raw.weekStart === 'string' && raw.weekStart.trim() !== '' ? Number(raw.weekStart.trim()) : raw.weekStart;
	const pal = typeof raw.palette === 'string' ? raw.palette.trim().toLowerCase() : '';
	const mode = typeof raw.sourceMode === 'string' ? raw.sourceMode.trim().toLowerCase() : '';
	const fmt = str(raw.customFormat, defaults.customFormat).trim();
	return {
		sourceMode: mode === 'auto' || mode === 'custom' ? mode : defaults.sourceMode,
		customFolder: str(raw.customFolder, defaults.customFolder),
		customFormat: fmt || defaults.customFormat,
		defaultHabit: str(raw.defaultHabit, defaults.defaultHabit).trim(),
		weekStart: ws === 0 || ws === 1 ? ws : defaults.weekStart,
		palette: (PALETTES as readonly string[]).includes(pal) ? pal as Palette : defaults.palette,
		exportFolder: str(raw.exportFolder, defaults.exportFolder).trim() || defaults.exportFolder,
	};
}
