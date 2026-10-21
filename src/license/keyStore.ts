/**
 * Where the license key itself is stored.
 *
 * - Obsidian 1.11.4+ exposes `app.secretStorage` (the "Keychain" in Settings). We keep the key there,
 *   so it never sits in plain text in the vault's data.json (which may be synced or committed).
 * - Older Obsidian: fall back to data.json.
 *
 * Pure logic, no `obsidian` import, so it can be unit-tested with a mock app.
 */

/** Subset of Obsidian's SecretStorage we use (verified against obsidian.d.ts 1.12.3). */
export interface SecretStorageLike {
	getSecret(id: string): string | null;
	setSecret(id: string, secret: string): void;
}

export interface KeyStore {
	readonly kind: 'keychain' | 'data.json';
	/** Returns the key to use. `legacyKey` is whatever data.json contained; migrated if needed. */
	load(legacyKey: string): string;
	/** Persist the key (no-op for data.json; the settings save handles it). */
	save(key: string): void;
	/** What should be written into data.json for the key field. */
	keyForDataJson(key: string): string;
}

/** Secret IDs must be lowercase alphanumeric with dashes. */
export const LICENSE_SECRET_ID = 'streakwise-license-key';
/** Secret id used by the pre-rename prototype; migrated on load. */
export const LEGACY_SECRET_IDS = ['placeholder-pro-plugin-license-key'];

export function selectKeyStore(app: { secretStorage?: SecretStorageLike }, secretId = LICENSE_SECRET_ID): KeyStore {
	const storage = app.secretStorage;
	if (storage && typeof storage.getSecret === 'function' && typeof storage.setSecret === 'function') {
		return keychainStore(storage, secretId);
	}
	return dataJsonStore;
}

const dataJsonStore: KeyStore = {
	kind: 'data.json',
	load: (legacyKey) => legacyKey,
	save: () => { /* stored with the rest of the settings */ },
	keyForDataJson: (key) => key,
};

function keychainStore(storage: SecretStorageLike, id: string): KeyStore {
	return {
		kind: 'keychain',
		load(legacyKey) {
			let stored = storage.getSecret(id) ?? '';
			for (const oldId of LEGACY_SECRET_IDS) {
				const old = storage.getSecret(oldId);
				if (!old) continue;
				if (!stored) { storage.setSecret(id, old); stored = old; }
				storage.setSecret(oldId, ''); // no delete API; empty = removed
			}
			// Migration: a plaintext key from an older version moves into the keychain.
			// If the keychain already has a key, it wins.
			if (!stored && legacyKey) {
				storage.setSecret(id, legacyKey);
				return legacyKey;
			}
			return stored;
		},
		// SecretStorage has no delete method; an empty string means "no key".
		save: (key) => storage.setSecret(id, key),
		keyForDataJson: () => '',
	};
}
