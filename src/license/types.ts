/**
 * Shared types for the Pro unlock module.
 * Kept free of any `obsidian` import so the logic can be unit-tested in plain Node.
 */

/** Minimal HTTP shape we need. In the plugin this wraps Obsidian's `requestUrl`. */
export interface HttpResponse {
	status: number;
	json: unknown;
}
export type HttpPost = (url: string, body: Record<string, unknown>) => Promise<HttpResponse>;

/** Returns "now" in milliseconds. Injected so tests can control time. */
export type Clock = () => number;

/** What we persist in the plugin's data.json. Never contains anything except the key the user typed and our own result. */
export interface LicenseCache {
	key: string;
	/** Polar activation id, only when device activations are enabled. */
	activationId: string | null;
	status: 'none' | 'valid' | 'invalid';
	/** Last time Polar said "granted" (ms). Grace period counts from here. */
	lastValidatedAt: number | null;
	/** Last time we attempted any check, success or not (ms). */
	lastCheckedAt: number | null;
	/** License expiry from Polar, if any (ms). */
	expiresAt: number | null;
	/** Short human-readable message for the settings tab. */
	message: string;
}

export const EMPTY_LICENSE: LicenseCache = {
	key: '',
	activationId: null,
	status: 'none',
	lastValidatedAt: null,
	lastCheckedAt: null,
	expiresAt: null,
	message: '',
};

export interface LicenseConfig {
	/** Polar organization id (public, safe to ship). Placeholder until Roger creates the product. */
	organizationId: string;
	/** Set true only if the Polar license benefit has device activations enabled. */
	useActivations: boolean;
	/** Polar customer portal, shown when the activation limit is reached. */
	portalUrl: string;
	/** Base URL, e.g. https://api.polar.sh or https://sandbox-api.polar.sh */
	apiBase: string;
	/** How long Pro stays unlocked without a successful online check. */
	gracePeriodMs: number;
	/** Minimum gap between automatic background re-checks. */
	recheckIntervalMs: number;
}
