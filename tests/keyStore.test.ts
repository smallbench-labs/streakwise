import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectKeyStore, LICENSE_SECRET_ID, LEGACY_SECRET_IDS, SecretStorageLike } from '../src/license/keyStore';

function mockSecretStorage(initial: Record<string, string> = {}) {
	const secrets = new Map(Object.entries(initial));
	const storage: SecretStorageLike = {
		getSecret: (id) => secrets.get(id) ?? null,
		setSecret: (id, s) => { secrets.set(id, s); },
	};
	return { storage, secrets };
}

test('older Obsidian (no secretStorage) falls back to data.json', () => {
	const store = selectKeyStore({});
	assert.equal(store.kind, 'data.json');
	assert.equal(store.load('KEY'), 'KEY');
	assert.equal(store.keyForDataJson('KEY'), 'KEY');
});

test('partial/incompatible secretStorage falls back to data.json', () => {
	const store = selectKeyStore({ secretStorage: {} as SecretStorageLike });
	assert.equal(store.kind, 'data.json');
});

test('Obsidian 1.11.4+ uses keychain and never writes key to data.json', () => {
	const { storage, secrets } = mockSecretStorage();
	const store = selectKeyStore({ secretStorage: storage });
	assert.equal(store.kind, 'keychain');
	store.save('NEW');
	assert.equal(secrets.get(LICENSE_SECRET_ID), 'NEW');
	assert.equal(store.keyForDataJson('NEW'), '');
});

test('migration: plaintext key moves into empty keychain', () => {
	const { storage, secrets } = mockSecretStorage();
	const store = selectKeyStore({ secretStorage: storage });
	assert.equal(store.load('OLD-PLAINTEXT'), 'OLD-PLAINTEXT');
	assert.equal(secrets.get(LICENSE_SECRET_ID), 'OLD-PLAINTEXT');
});

test('migration: existing keychain key wins over stale data.json key', () => {
	const { storage, secrets } = mockSecretStorage({ [LICENSE_SECRET_ID]: 'IN-KEYCHAIN' });
	const store = selectKeyStore({ secretStorage: storage });
	assert.equal(store.load('STALE'), 'IN-KEYCHAIN');
	assert.equal(secrets.get(LICENSE_SECRET_ID), 'IN-KEYCHAIN');
});

test('no key anywhere: loads empty, writes nothing', () => {
	const { storage, secrets } = mockSecretStorage();
	assert.equal(selectKeyStore({ secretStorage: storage }).load(''), '');
	assert.equal(secrets.size, 0);
});

test('remove: empty string clears the keychain entry', () => {
	const { storage, secrets } = mockSecretStorage({ [LICENSE_SECRET_ID]: 'K' });
	const store = selectKeyStore({ secretStorage: storage });
	store.save('');
	assert.equal(secrets.get(LICENSE_SECRET_ID), '');
	assert.equal(store.load(''), '');
});

test('secret id is valid (lowercase alphanumeric + dashes)', () => {
	assert.match(LICENSE_SECRET_ID, /^[a-z0-9-]+$/);
});

test('rename: key under old placeholder secret id moves to streakwise id', () => {
	const old = LEGACY_SECRET_IDS[0];
	const { storage, secrets } = mockSecretStorage({ [old]: 'OLD-ID-KEY' });
	const store = selectKeyStore({ secretStorage: storage });
	assert.equal(LICENSE_SECRET_ID, 'streakwise-license-key');
	assert.equal(store.load(''), 'OLD-ID-KEY');
	assert.equal(secrets.get(LICENSE_SECRET_ID), 'OLD-ID-KEY');
	assert.equal(secrets.get(old), '');
});

test('rename: new id wins, old id still cleared', () => {
	const old = LEGACY_SECRET_IDS[0];
	const { storage, secrets } = mockSecretStorage({ [old]: 'OLD', [LICENSE_SECRET_ID]: 'NEW' });
	assert.equal(selectKeyStore({ secretStorage: storage }).load(''), 'NEW');
	assert.equal(secrets.get(old), '');
});
