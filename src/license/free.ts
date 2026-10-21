import type { LicenseManager } from './licenseManager';
import type { KeyStore } from './keyStore';
import { EMPTY_LICENSE } from './types';

/** Stand-in used by the free-only build: no network code, Pro never unlocks. */
export const FREE_LICENSE = {
	state: EMPTY_LICENSE,
	isPro: () => false,
	isConfigured: () => false,
	graceDaysLeft: () => 0,
	refreshIfDue: async () => EMPTY_LICENSE,
	activate: async () => EMPTY_LICENSE,
	clear: async () => {},
} as unknown as LicenseManager;

export const FREE_KEY_STORE: KeyStore = {
	kind: 'data.json',
	load: () => '',
	save: () => {},
	keyForDataJson: () => '',
};
