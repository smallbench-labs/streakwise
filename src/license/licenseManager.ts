import { Clock, EMPTY_LICENSE, HttpPost, LicenseCache, LicenseConfig } from './types';

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_LICENSE_CONFIG: LicenseConfig = {
	organizationId: 'REPLACE_WITH_POLAR_ORG_ID',
	useActivations: true, // Polar benefit: 5 activations per key, keys never expire
	portalUrl: 'https://polar.sh/REPLACE_WITH_ORG_SLUG/portal',
	apiBase: 'https://api.polar.sh',
	gracePeriodMs: 604_800_000, // 7 days (literal so the free build can tree-shake this object)
	recheckIntervalMs: 86_400_000, // 1 day
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pro unlock logic using Polar's public customer-portal license key endpoints.
 *
 * Rules:
 * - No key entered  -> never touches the network.
 * - Pro is unlocked while the last successful validation is within the grace period
 *   (and the license itself has not expired).
 * - A network failure keeps the cached result; only an explicit "not found / not permitted"
 *   answer from Polar marks the key invalid.
 */
export class LicenseManager {
	constructor(
		private cache: LicenseCache,
		private readonly config: LicenseConfig,
		private readonly http: HttpPost,
		private readonly now: Clock,
		private readonly save: (cache: LicenseCache) => Promise<void>,
	) {}

	get state(): Readonly<LicenseCache> {
		return this.cache;
	}

	/** Pure, offline check. Safe to call as often as you like. */
	isPro(): boolean {
		// Free-only build (no Polar org ID): Pro never unlocks, even from an old cached result.
		if (!this.isConfigured()) return false;
		const c = this.cache;
		if (c.status !== 'valid' || c.lastValidatedAt === null) return false;
		const t = this.now();
		if (c.expiresAt !== null && t >= c.expiresAt) return false;
		return t - c.lastValidatedAt <= this.config.gracePeriodMs;
	}

	/** Days left before Pro locks if we stay offline. 0 when not Pro. */
	graceDaysLeft(): number {
		if (!this.isPro() || this.cache.lastValidatedAt === null) return 0;
		const left = this.cache.lastValidatedAt + this.config.gracePeriodMs - this.now();
		return Math.max(0, Math.ceil(left / DAY));
	}

	isConfigured(): boolean {
		return UUID_RE.test(this.config.organizationId);
	}

	/** User pressed "Activate" with a (new) key. */
	async activate(rawKey: string, deviceLabel: string): Promise<LicenseCache> {
		const key = rawKey.trim();
		if (!key) return this.clear();
		if (!this.isConfigured()) {
			return this.update({ ...EMPTY_LICENSE, key, message: 'Pro unlock is not configured in this build.' });
		}

		const keyChanged = key !== this.cache.key;
		this.cache = keyChanged ? { ...EMPTY_LICENSE, key } : { ...this.cache, key };

		this.deviceLabel = deviceLabel;
		if (this.config.useActivations && !this.cache.activationId) {
			const failed = await this.reserveActivation();
			if (failed) return failed;
		}
		return this.validate();
	}

	private deviceLabel = 'Obsidian';

	/** Asks Polar for a device slot. Returns a final state on failure, or null on success. */
	private async reserveActivation(): Promise<LicenseCache | null> {
		const res = await this.post('/v1/customer-portal/license-keys/activate', {
			key: this.cache.key,
			organization_id: this.config.organizationId,
			label: this.deviceLabel.slice(0, 100) || 'Obsidian',
		});
		if (res === 'offline') return this.markOffline();
		if (res.status !== 200) return this.markInvalid(res.status);
		const id = (res.json as { id?: unknown }).id;
		this.cache.activationId = typeof id === 'string' ? id : null;
		return null;
	}

	/** Called on plugin load. Re-checks at most once per `recheckIntervalMs`; never if no key. */
	async refreshIfDue(): Promise<LicenseCache> {
		if (!this.cache.key || !this.isConfigured()) return this.cache;
		const last = this.cache.lastCheckedAt ?? 0;
		if (this.now() - last < this.config.recheckIntervalMs) return this.cache;
		return this.validate();
	}

	/** Remove the key and everything cached. Purely local. */
	async clear(): Promise<LicenseCache> {
		return this.update({ ...EMPTY_LICENSE });
	}

	private async validate(allowReactivate = true): Promise<LicenseCache> {
		const body: Record<string, unknown> = {
			key: this.cache.key,
			organization_id: this.config.organizationId,
		};
		if (this.cache.activationId) body.activation_id = this.cache.activationId;

		const res = await this.post('/v1/customer-portal/license-keys/validate', body);
		if (res === 'offline') return this.markOffline();

		// Stale activation (e.g. the user freed this device in the Polar portal):
		// drop the old activation id and reserve a fresh slot once.
		if (res.status === 404 && this.cache.activationId && this.config.useActivations && allowReactivate) {
			this.cache.activationId = null;
			const failed = await this.reserveActivation();
			if (failed) return failed;
			return this.validate(false);
		}
		if (res.status !== 200) return this.markInvalid(res.status);

		const data = res.json as { status?: unknown; expires_at?: unknown };
		if (data.status !== 'granted') return this.markInvalid(res.status);
		const expiresAt = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : null;
		const t = this.now();
		return this.update({
			...this.cache,
			status: 'valid',
			lastValidatedAt: t,
			lastCheckedAt: t,
			expiresAt: Number.isNaN(expiresAt) ? null : expiresAt,
			message: 'License valid. Pro features unlocked.',
		});
	}

	private async post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown } | 'offline'> {
		// Defence in depth: a free-only build must never touch the network.
		if (!this.isConfigured()) return 'offline';
		try {
			return await this.http(this.config.apiBase + path, body);
		} catch {
			return 'offline';
		}
	}

	private markOffline(): Promise<LicenseCache> {
		const pro = this.isPro();
		return this.update({
			...this.cache,
			lastCheckedAt: this.now(),
			message: pro
				? `Could not reach the license server. Pro stays unlocked offline for ${this.graceDaysLeft()} more day(s).`
				: 'Could not reach the license server. Check your connection and try again.',
		});
	}

	private markInvalid(httpStatus: number): Promise<LicenseCache> {
		// 5xx / 429 are server trouble, not a verdict on the key: treat like offline.
		if (httpStatus >= 500 || httpStatus === 429) return this.markOffline();
		const why = httpStatus === 403
			? `All activations for this key are in use, or the key was revoked. Free a device in your Polar customer portal (${this.config.portalUrl}) and press Activate again.`
			: 'License key not recognised, revoked or expired.';
		return this.update({
			...this.cache,
			status: 'invalid',
			activationId: null,
			lastValidatedAt: null,
			lastCheckedAt: this.now(),
			message: why,
		});
	}

	private async update(next: LicenseCache): Promise<LicenseCache> {
		this.cache = next;
		await this.save(next);
		return next;
	}
}
