import { App, PluginSettingTab, Setting } from 'obsidian';
import type StreakwisePlugin from './main';
import { EMPTY_LICENSE, LicenseCache } from './license/types';
import { PALETTES, Palette } from './core/blockConfig';
import { WeekStart } from './core/dates';
import { SourceSettings, resolveDailySource } from './obsidian/dataSource';

export interface StreakwiseSettings extends SourceSettings {
	defaultHabit: string;
	weekStart: WeekStart;
	palette: Palette;
	exportFolder: string;
	license: LicenseCache;
}

export const DEFAULT_SETTINGS: StreakwiseSettings = {
	sourceMode: 'auto',
	customFolder: '',
	customFormat: 'YYYY-MM-DD',
	defaultHabit: '',
	weekStart: 1,
	palette: 'green',
	exportFolder: 'Streakwise exports',
	license: { ...EMPTY_LICENSE },
};

export class StreakwiseSettingTab extends PluginSettingTab {
	private keyDraft = '';

	constructor(app: App, private plugin: StreakwisePlugin) {
		super(app, plugin);
	}

	private async update(change: (s: StreakwiseSettings) => void, redisplay = false) {
		change(this.plugin.settings);
		await this.plugin.saveSettings();
		this.plugin.refreshAfterSettings();
		if (redisplay) this.display();
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		// --- Daily notes source ---
		new Setting(containerEl).setName('Daily notes').setHeading();
		const detected = resolveDailySource(this.app, s);
		new Setting(containerEl)
			.setName('Daily notes location')
			.setDesc(`Using ${detected.origin}: folder "${detected.folder || '/'}", format ${detected.format}.`)
			.addDropdown((d) => d
				.addOption('auto', 'Follow Daily notes / Periodic Notes')
				.addOption('custom', 'Custom')
				.setValue(s.sourceMode)
				.onChange((v) => { void this.update((x) => { x.sourceMode = v as 'auto' | 'custom'; }, true); }));
		new Setting(containerEl)
			.setName('Custom folder')
			.setDesc('Used with the custom location, or when no daily notes plugin is enabled.')
			.addText((t) => t.setPlaceholder('Journal/daily').setValue(s.customFolder)
				.onChange((v) => { void this.update((x) => { x.customFolder = v; }); }));
		new Setting(containerEl)
			.setName('Custom date format')
			.setDesc('Moment.js format of the note name, e.g. YYYY-MM-DD or YYYY/MM/YYYY-MM-DD.')
			.addText((t) => t.setPlaceholder('YYYY-MM-DD').setValue(s.customFormat)
				.onChange((v) => { void this.update((x) => { x.customFormat = v; }); }));

		// --- Display ---
		new Setting(containerEl).setName('Display').setHeading();
		new Setting(containerEl)
			.setName('Default habit')
			.setDesc('Frontmatter property used when a block has no "habits:" line.')
			.addText((t) => t.setPlaceholder('exercise').setValue(s.defaultHabit)
				.onChange((v) => { void this.update((x) => { x.defaultHabit = v.trim(); }); }));
		new Setting(containerEl)
			.setName('Week starts on')
			.addDropdown((d) => d.addOption('1', 'Monday').addOption('0', 'Sunday')
				.setValue(String(s.weekStart))
				.onChange((v) => { void this.update((x) => { x.weekStart = v === '0' ? 0 : 1; }); }));
		new Setting(containerEl)
			.setName('Colors')
			.addDropdown((d) => {
				for (const p of PALETTES) d.addOption(p, p.charAt(0).toUpperCase() + p.slice(1));
				d.setValue(s.palette).onChange((v) => { void this.update((x) => { x.palette = v as Palette; }); });
			});
		new Setting(containerEl)
			.setName('PNG export folder')
			.setDesc(this.plugin.license.isConfigured() ? 'Pro. Exported images are saved inside your vault.' : 'Pro (coming soon). Exported images are saved inside your vault.')
			.addText((t) => t.setValue(s.exportFolder)
				.onChange((v) => { void this.update((x) => { x.exportFolder = v.trim(); }); }));

		// --- Pro ---
		this.displayLicense(containerEl);
	}

	private displayLicense(containerEl: HTMLElement) {
		const lic = this.plugin.license;
		if (FREE_BUILD || !lic.isConfigured()) {
			// Free-only build: no key field, no purchase link, no network.
			new Setting(containerEl).setName('Pro').setHeading();
			new Setting(containerEl)
				.setName('Streakwise Pro — coming soon')
				.setDesc('Free version: yearly heatmap of one habit. Pro features (month, week, quarter and '
					+ 'year-to-date views, multiple habits and PNG export) are coming soon.');
			return;
		}
		this.keyDraft = lic.state.key;
		new Setting(containerEl).setName('Pro license').setHeading();
		const status = lic.isPro()
			? `Pro unlocked (offline grace: ${lic.graceDaysLeft()} day(s) left).`
			: lic.state.status === 'invalid' ? 'Pro locked.' : 'Free version: yearly heatmap of one habit.';
		new Setting(containerEl)
			.setName('Status')
			.setDesc(lic.state.message ? `${status} ${lic.state.message}` : status);

		new Setting(containerEl)
			.setName('License key')
			.setDesc(
				'Pro adds month, week, quarter and year-to-date views, multiple habits and PNG export. '
				+ (this.plugin.keyStore.kind === 'keychain'
					? 'The key is stored in Obsidian Keychain, not in your vault files. '
					: 'The key is stored in this plugin\'s data.json in your vault. ')
				+ 'It is sent only to Polar (api.polar.sh) to verify it, and only when you press Activate or once a day afterwards.')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setPlaceholder('License key').setValue(this.keyDraft)
					.onChange((v) => { this.keyDraft = v; });
			})
			.addButton((b) => b.setButtonText('Activate').setCta().onClick(async () => {
				b.setDisabled(true);
				await lic.activate(this.keyDraft, 'Obsidian');
				this.display();
			}))
			.addButton((b) => b.setButtonText('Remove').onClick(async () => {
				await lic.clear();
				this.display();
			}));
	}
}
