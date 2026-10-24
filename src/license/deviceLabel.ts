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

/** Uniform random in [0,1) from the Web Crypto API (rejection-free: 32-bit / 2^32). Falls back to Math.random. */
export function cryptoRandom(): number {
	const c = typeof crypto !== 'undefined' ? crypto : undefined; // Web Crypto: Electron, iOS/Android WebView, Node 19+
	if (c && typeof c.getRandomValues === 'function') return (c.getRandomValues(new Uint32Array(1))[0] ?? 0) / 4294967296;
	return Math.random();
}

/** Random 4-char lowercase code [0-9a-z]. */
export function randomDeviceCode(rand: () => number = cryptoRandom): string {
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

/**
 * Device-local storage for the device code. Not data.json: it can sync to other devices with the vault.
 * Obsidian 1.8.7+: app.loadLocalStorage (per vault, per device); older: window.localStorage (per device).
 * Module-level (not a plugin method) so FREE_BUILD bundles tree-shake it away.
 */
export function appLocalStore(app: unknown): LocalStore {
	const a = app as { loadLocalStorage?: (k: string) => unknown; saveLocalStorage?: (k: string, v: string) => void };
	if (typeof a.loadLocalStorage === 'function' && typeof a.saveLocalStorage === 'function') {
		return { load: (k) => a.loadLocalStorage?.(k), save: (k, v) => a.saveLocalStorage?.(k, v) };
	}
	return {
		load: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
		save: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* storage unavailable: code is regenerated next load */ } },
	};
}
