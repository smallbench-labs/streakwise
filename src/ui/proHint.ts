/**
 * One quiet line under a free heatmap that says what Pro adds (0.3.x, 行銷 review 2026-11-24).
 * Opens the Pro section in settings (same target as "See Streakwise Pro"); no URL, no modal.
 * Once dismissed it never comes back (stored as proHintDismissed in data.json).
 */
export const PRO_HINT_TEXT = 'Pro: more views, multiple habits, PNG export';

export interface ProHintState {
	/** Licensed Pro users never see it. */
	isPro: boolean;
	/** Free-only build or Pro not configured: Pro can't be bought, so nothing to point at. */
	proSoon: boolean;
	/** The user closed it once. */
	dismissed: boolean;
	/** This block already shows a Pro card (locked view or flexible-streak preview): don't prompt twice. */
	proCardShown: boolean;
	/** The block has config errors: fix those first. */
	hasErrors: boolean;
}

export function shouldShowProHint(s: ProHintState): boolean {
	return !s.isPro && !s.proSoon && !s.dismissed && !s.proCardShown && !s.hasErrors;
}

interface HintParent {
	createDiv(o?: { cls?: string; text?: string; attr?: Record<string, string> }): HintParent;
	createEl(tag: 'button', o?: { cls?: string; text?: string; attr?: Record<string, string> }): HintParent;
	addEventListener(type: 'click', l: (e: { preventDefault(): void; stopPropagation(): void }) => void): void;
}

/** Draws the line into `parent`; the caller wires the two actions. Returns the line element. */
export function renderProHint<T extends HintParent>(
	parent: T,
	actions: { open: () => void; dismiss: () => void },
	icon?: (el: T, name: string) => void,
): T {
	const line = parent.createDiv({ cls: 'sw-pro-hint' }) as T;
	const link = line.createEl('button', { cls: 'sw-pro-hint-link', text: PRO_HINT_TEXT, attr: { type: 'button', 'aria-label': `${PRO_HINT_TEXT}. Opens Streakwise settings.` } }) as T;
	link.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); actions.open(); });
	const close = line.createEl('button', { cls: 'clickable-icon sw-pro-hint-close', attr: { type: 'button', 'aria-label': 'Hide this Pro hint' } }) as T;
	if (icon) icon(close, 'x');
	close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); actions.dismiss(); });
	return line;
}
