import { CONSENT_HINT, ConsentState, PRIVACY_URL, TERMS_URL } from './consent';

let seq = 0;

/**
 * Consent block under the "Get Streakwise Pro" description (UIUX spec):
 * checkbox row, then the Buy button, then the hint; left-aligned, no box.
 * Uses Obsidian's DOM helpers (createEl/createDiv/...) only; no `obsidian` import, so it is unit-testable.
 * - The native checkbox is wrapped by a <label> covering the whole row (hit area >= 44px via CSS).
 * - Links open in a new window (rel=noopener) and never toggle the checkbox.
 * - Unchecked: the button is aria-disabled (not disabled), described by the hint. Clicking it does not
 *   open checkout; focus moves to the checkbox and the hint uses the error colour until the box is checked.
 */
export function buildConsentBlock(
	parent: HTMLElement,
	consent: ConsentState,
	buy: () => boolean,
	openUrl: (url: string) => void,
): { box: HTMLInputElement; button: HTMLButtonElement; hint: HTMLElement; block: HTMLElement; label: HTMLElement; links: HTMLElement[] } {
	const id = `sw-consent-${++seq}`;
	const block = parent.createDiv({ cls: 'sw-consent-block' });

	const label = block.createEl('label', { cls: 'sw-consent' });
	const box = label.createEl('input', { type: 'checkbox', attr: { id: `${id}-box` } });
	box.checked = false;
	const text = label.createSpan({ cls: 'sw-consent-text' });
	const links: HTMLElement[] = [];
	const link = (s: string, url: string) => {
		const a = text.createEl('a', { cls: 'sw-consent-link', text: s, attr: { href: url, target: '_blank', rel: 'noopener' } });
		a.createSpan({ cls: 'sw-sr-only', text: ' (opens in new window)' });
		// Opening a link must not toggle the checkbox (the label would otherwise forward the click).
		a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openUrl(url); });
		links.push(a);
	};
	text.appendText('I agree to the ');
	link('Terms of Service', TERMS_URL);
	text.appendText(' and ');
	link('Privacy Policy', PRIVACY_URL);
	text.appendText('.');

	const button = block.createEl('button', { cls: 'sw-buy-button mod-cta', text: 'Buy Pro – US$19', attr: { type: 'button' } });
	const hint = block.createDiv({ cls: 'sw-consent-hint', text: CONSENT_HINT, attr: { id: `${id}-hint` } });

	const apply = (on: boolean) => {
		if (on) {
			button.removeAttribute('aria-disabled');
			button.removeAttribute('aria-describedby');
			hint.removeClass('sw-consent-hint-error');
			hint.detach();
		} else {
			button.setAttr('aria-disabled', 'true');
			button.setAttr('aria-describedby', `${id}-hint`);
			if (!hint.parentElement) block.appendChild(hint);
		}
	};
	apply(false);
	box.addEventListener('change', () => consent.set(box.checked));
	consent.onChange(apply);

	button.addEventListener('click', (e) => {
		if (!consent.isChecked) {
			e.preventDefault();
			box.focus();
			// Stays in the error colour until the user checks the box.
			hint.addClass('sw-consent-hint-error');
			return;
		}
		buy();
	});

	return { box, button, hint, block, label, links };
}
