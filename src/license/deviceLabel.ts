/**
 * S-39: Polar activation label, so the user can tell devices apart in the customer portal.
 * "Obsidian – <platform> – <id4>": no vault name, user name, email or host name.
 * The 4-character device code is random and kept in device-local storage (not data.json,
 * which can sync to other devices with the vault). Pure, no `obsidian` import.
 */
export interface PlatformFlags {
	isMacOS?: boolean;
	isWin?: boolean;
	isLinux?: boolean;
	isIosApp?: boolean;
	isAndroidApp?: boolean;
}

export interface LocalStore {
	load(key: string): unknown;
	save(key: string, value: string): void;
}

export const DEVICE_CODE_KEY = 'streakwise-device-code';
const CODE_RE = /^[0-9a-z]{4}$/;

export function platformName(p: PlatformFlags): string {
	if (p.isIosApp) return 'iOS';
	if (p.isAndroidApp) return 'Android';
	if (p.isMacOS) return 'macOS';
	if (p.isWin) return 'Windows';
	if (p.isLinux) return 'Linux';
	return 'Unknown platform';
}

/** Random 4-char lowercase code [0-9a-z]. */
export function randomDeviceCode(rand: () => number = Math.random): string {
	const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
	let out = '';
	for (let i = 0; i < 4; i++) out += chars[Math.floor(rand() * chars.length) % chars.length];
	return out;
}

/** Returns this device's code, creating and persisting it on first use. */
export function getDeviceCode(store: LocalStore, rand?: () => number): string {
	const existing = store.load(DEVICE_CODE_KEY);
	if (typeof existing === 'string' && CODE_RE.test(existing)) return existing;
	const code = randomDeviceCode(rand);
	store.save(DEVICE_CODE_KEY, code);
	return code;
}

export function buildDeviceLabel(p: PlatformFlags, code: string): string {
	return ['Obsidian', platformName(p), code].join(' – ');
}
