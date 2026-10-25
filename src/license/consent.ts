/**
 * Purchase consent next to "Buy Pro". Pure, no `obsidian` import.
 * Never persisted: a fresh ConsentState (unchecked) is created each time the settings tab is drawn.
 */
export const TERMS_URL = 'https://formchime.com/streakwise/terms';
export const PRIVACY_URL = 'https://formchime.com/streakwise/privacy';
export const CONSENT_HINT = 'Check the box above to continue.';

export class ConsentState {
	private checked = false;
	private listeners: Array<(checked: boolean) => void> = [];

	get isChecked(): boolean {
		return this.checked;
	}

	set(checked: boolean): void {
		this.checked = checked;
		for (const l of this.listeners) l(checked);
	}

	onChange(l: (checked: boolean) => void): void {
		this.listeners.push(l);
	}
}

/**
 * The checkout handler itself refuses without consent (the disabled button is not the only guard).
 * Returns true if the checkout was opened.
 */
export function openCheckoutIfConsented(consent: ConsentState, url: string, open: (url: string) => void): boolean {
	if (!consent.isChecked) return false;
	open(url);
	return true;
}
