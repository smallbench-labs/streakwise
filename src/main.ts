import { Editor, Plugin, debounce } from 'obsidian';
import { DEFAULT_SETTINGS, StreakwiseSettingTab, StreakwiseSettings } from './settings';
import { LicenseManager, DEFAULT_LICENSE_CONFIG } from './license/licenseManager';
import { obsidianHttpPost } from './license/obsidianHttp';
import { KeyStore, selectKeyStore } from './license/keyStore';
import { FREE_LICENSE, FREE_KEY_STORE } from './license/free';
import { HeatmapBlock } from './obsidian/heatmapBlock';
import { DailyNoteIndex } from './obsidian/dataSource';

export const BLOCK_LANGUAGE = 'streakwise';

export default class StreakwisePlugin extends Plugin {
	settings!: StreakwiseSettings;
	license!: LicenseManager;
	keyStore!: KeyStore;
	/** Rendered blocks, so they can refresh after Pro is unlocked or settings change. */
	readonly blocks = new Set<HeatmapBlock>();
	/** One shared scan of daily notes for all blocks. */
	dailyIndex!: DailyNoteIndex;

	async onload() {
		await this.loadSettings();
		this.dailyIndex = new DailyNoteIndex(this.app);

		// Any change that can affect which notes are daily notes or their values (S-01: includes rename).
		const notesChanged = debounce(() => { this.dailyIndex.invalidate(); this.refreshBlocks(); }, 500, true);
		this.registerEvent(this.app.metadataCache.on('changed', notesChanged));
		this.registerEvent(this.app.vault.on('create', notesChanged));
		this.registerEvent(this.app.vault.on('delete', notesChanged));
		this.registerEvent(this.app.vault.on('rename', notesChanged));

		// FREE_BUILD (v0.1.x): esbuild drops the license/HTTP code entirely; Pro never unlocks.
		this.license = FREE_BUILD ? FREE_LICENSE : new LicenseManager(
			this.settings.license,
			DEFAULT_LICENSE_CONFIG,
			obsidianHttpPost,
			() => Date.now(),
			async (cache) => {
				this.keyStore.save(cache.key);
				this.settings.license = cache;
				await this.saveSettings();
				this.refreshBlocks();
			},
		);

		this.registerMarkdownCodeBlockProcessor(BLOCK_LANGUAGE, (source, el, ctx) => {
			ctx.addChild(new HeatmapBlock(el, source, this));
		});

		this.addCommand({
			id: 'insert-heatmap',
			name: 'Insert heatmap block',
			editorCallback: (editor: Editor) => {
				const habit = this.settings.defaultHabit || 'habit';
				editor.replaceSelection('```' + BLOCK_LANGUAGE + '\nhabits: ' + habit + '\nview: year\n```\n');
			},
		});

		this.addSettingTab(new StreakwiseSettingTab(this.app, this));

		// Background license re-check only when a key exists; never blocks startup.
		if (!FREE_BUILD) this.app.workspace.onLayoutReady(() => { void this.license.refreshIfDue(); });
	}

	/** Re-render visible blocks, e.g. after settings change (the folder/format may differ). */
	refreshAfterSettings() {
		this.dailyIndex.invalidate();
		this.refreshBlocks();
	}

	refreshBlocks() {
		// S-09: a block whose element left the DOM (note closed or re-rendered) is dropped here,
		// because Obsidian does not always unload render children of a replaced view right away.
		// Obsidian renders fresh children when that note is shown again.
		for (const b of [...this.blocks]) {
			if (b.containerEl.isConnected) b.render();
			else this.blocks.delete(b);
		}
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<StreakwiseSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...data, license: { ...DEFAULT_SETTINGS.license, ...data?.license } };

		// Keychain on Obsidian 1.11.4+, data.json on older versions.
		this.keyStore = FREE_BUILD ? FREE_KEY_STORE : selectKeyStore(this.app);
		const legacyKey = this.settings.license.key;
		this.settings.license.key = this.keyStore.load(legacyKey);
		if (this.keyStore.kind === 'keychain' && legacyKey) {
			await this.saveSettings(); // migration: drop the plaintext copy from data.json
		}
	}

	async saveSettings() {
		const license = { ...this.settings.license, key: this.keyStore.keyForDataJson(this.settings.license.key) };
		await this.saveData({ ...this.settings, license });
	}
}
