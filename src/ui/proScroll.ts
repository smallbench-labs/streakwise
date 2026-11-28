/**
 * After the free-version Pro hint is clicked, settings should scroll to the
 * Pro / consent section. A Learn more link points at the public Pro section.
 */

export const PRO_LEARN_MORE_URL = 'https://formchime.com/streakwise/#pro';
export const PRO_LEARN_MORE_TEXT = 'Learn more';

interface ElLike {
	hidden?: boolean;
	parentElement?: ElLike | null;
	style?: { display?: string };
	ownerDocument?: { defaultView?: { getComputedStyle?: (el: unknown) => { display: string; visibility: string } | null } | null } | null;
	querySelector?: (sel: string) => ElLike | null;
	closest?: (sel: string) => ElLike | null;
	scrollIntoView?: (opts?: ScrollIntoViewOptions) => void;
}

function asEl(root: unknown): ElLike | null {
	if (!root || typeof root !== 'object') return null;
	return root;
}

function isShown(el: ElLike | null | undefined): el is ElLike {
	let n: ElLike | null | undefined = el;
	while (n) {
		if (n.hidden) return false;
		if (n.style?.display === 'none') return false;
		const view = n.ownerDocument?.defaultView;
		const cs = view?.getComputedStyle?.(n);
		if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
		n = n.parentElement;
	}
	return !!el;
}

/** Prefer the visible consent block; otherwise the Learn more row or Pro heading. */
export function findProScrollTarget(root: unknown): ElLike | null {
	const el = asEl(root);
	if (!el?.querySelector) return null;
	const consent = el.querySelector('.sw-consent-block');
	if (isShown(consent)) return consent;
	const learn = el.querySelector('a.sw-pro-learn-more');
	if (isShown(learn)) return learn.closest?.('.setting-item') ?? learn;
	return el.querySelector('.sw-pro-section');
}

export function scrollProSectionIntoView(root: unknown): boolean {
	const target = findProScrollTarget(root);
	if (!target?.scrollIntoView) return false;
	target.scrollIntoView({ block: 'center', inline: 'nearest' });
	return true;
}

/** Whether the preferred target (the consent block) is on screen, so retries can stop. */
export function proConsentIsShown(root: unknown): boolean {
	const el = asEl(root);
	return !!el?.querySelector && isShown(el.querySelector('.sw-consent-block'));
}

interface LinkParent {
	createEl(tag: 'a', o: { cls?: string; text?: string; attr?: Record<string, string> }): unknown;
}

export function appendLearnMoreLink(parent: LinkParent): void {
	parent.createEl('a', {
		cls: 'sw-pro-learn-more',
		text: PRO_LEARN_MORE_TEXT,
		attr: { href: PRO_LEARN_MORE_URL, target: '_blank', rel: 'noopener noreferrer' },
	});
}
