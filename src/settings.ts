import { App, PluginSettingTab, Setting } from 'obsidian';
import type StreakwisePlugin from './main';
import { EMPTY_LICENSE, LicenseCache } from './license/types';
import { PALETTES, Palette } from './core/blockConfig';
import { WeekStart } from './core/dates';
import { SourceSettings, resolveDailySource } from './obsidian/dataSource';
import { renderLegendSwatches } from './obsidian/renderSvg';
import { hasDeclarativeSettings } from './settingsCompat';

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
	palette: 'accent',
	exportFolder: 'Streakwise exports',
	license: { ...EMPTY_LICENSE },
};

/**
 * One settings row, shared by both renderers so they cannot drift:
 * - Obsidian 1.13+: returned from getSettingDefinitions() (declarative, indexed by settings search).
 * - Older Obsidian: drawn imperatively by display().
 * Typed locally because the bundled obsidian.d.ts (1.12.x) predates the declarative API.
 */
interface Row {
	name: string;
	desc?: string;
	render?: (setting: Setting) => void;
}
interface Section {
	heading: string;
	rows: Row[];
}
/** Minimal shapes of Obsidian 1.13's SettingDefinitionItem we produce. */
interface RowDefinition {
	name: string;
	desc?: string;
	render?: (setting: Setting) => void;
}
interface GroupDefinition {
	type: 'group';
	heading: string;
	items: RowDefinition[];
}

export class StreakwiseSettingTab extends PluginSettingTab {
	private keyDraft = '';

	constructor(app: App, private plugin: StreakwisePlugin) {
		super(app, plugin);
	}

	/** Re-render: declarative tabs must use the base update(); display() is bypassed on 1.13+. */
	private refresh() {
		if (hasDeclarativeSettings(PluginSettingTab.prototype)) {
			(PluginSettingTab.prototype as unknown as { update: (this: PluginSettingTab) => void }).update.call(this);
		} else {
			this.display();
		}
	}

	// Named applyChange, not update: on 1.13+ the base class owns update() and calls it from addSettingTab().
	private async applyChange(change: (s: StreakwiseSettings) => void, redisplay = false) {
		change(this.plugin.settings);
		await this.plugin.saveSettings();
		this.plugin.refreshAfterSettings();
		if (redisplay) this.refresh();
	}

	/** Obsidian 1.13+: settings render declaratively and appear in the global settings search. */
	getSettingDefinitions(): GroupDefinition[] {
		return this.sections().map((sec) => ({
			type: 'group',
			heading: sec.heading,
			items: sec.rows.map((r) => {
				const def: RowDefinition = { name: r.name };
				if (r.desc !== undefined) def.desc = r.desc;
				if (r.render) def.render = r.render;
				return def;
			}),
		}));
	}

	/** Obsidian < 1.13: imperative fallback built from the same rows. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const sec of this.sections()) {
			new Setting(containerEl).setName(sec.heading).setHeading();
			for (const r of sec.rows) {
				const setting = new Setting(containerEl).setName(r.name);
				if (r.desc !== undefined) setting.setDesc(r.desc);
				r.render?.(setting);
			}
		}
	}

	private sections(): Section[] {
		const s = this.plugin.settings;
		const detected = resolveDailySource(this.app, s);
		const display: Row[] = [
			{
				name: 'Default habit',
				desc: 'Frontmatter property used when a block has no "habits:" line.',
				render: (st) => { st.addText((t) => t.setPlaceholder('exercise').setValue(s.defaultHabit)
					.onChange((v) => { void this.applyChange((x) => { x.defaultHabit = v.trim(); }); })); },
			},
			{
				name: 'Week starts on',
				desc: 'First row of the yearly heatmap. A block can override it with "weekstart:".',
				render: (st) => { st.addDropdown((d) => d.addOption('1', 'Monday').addOption('0', 'Sunday')
					.setValue(String(s.weekStart))
					.onChange((v) => { void this.applyChange((x) => { x.weekStart = v === '0' ? 0 : 1; }); })); },
			},
			{
				name: 'Colors',
				desc: 'Accent follows your theme. A block can override it with "colors:".',
				render: (st) => {
					const preview = st.controlEl.createDiv({ cls: 'sw-swatch-preview', attr: { 'aria-hidden': 'true' } });
					const drawPreview = (p: Palette) => {
						preview.empty();
						preview.appendChild(renderLegendSwatches(p));
					};
					drawPreview(s.palette);
					st.addDropdown((d) => {
						for (const p of PALETTES) d.addOption(p, p === 'accent' ? 'Accent (follow theme)' : p.charAt(0).toUpperCase() + p.slice(1));
						d.setValue(s.palette).onChange((v) => {
							drawPreview(v as Palette);
							void this.applyChange((x) => { x.palette = v as Palette; });
						});
					});
				},
			},
		];
		// PNG export is Pro-only; the free build has no export, so no setting either.
		if (!FREE_BUILD && this.plugin.license.isConfigured()) {
			display.push({
				name: 'PNG export folder',
				desc: 'Pro. Exported images are saved inside your vault.',
				render: (st) => { st.addText((t) => t.setValue(s.exportFolder)
					.onChange((v) => { void this.applyChange((x) => { x.exportFolder = v.trim(); }); })); },
			});
		}
		return [
			{
				heading: 'Daily notes',
				rows: [
					{
						name: 'Daily notes location',
						desc: `Using ${detected.origin}: folder "${detected.folder || '/'}", format ${detected.format}.`,
						render: (st) => { st.addDropdown((d) => d
							.addOption('auto', 'Follow Daily notes / Periodic Notes')
							.addOption('custom', 'Custom')
							.setValue(s.sourceMode)
							.onChange((v) => { void this.applyChange((x) => { x.sourceMode = v as 'auto' | 'custom'; }, true); })); },
					},
					{
						name: 'Custom folder',
						desc: 'Used with the custom location, or when no daily notes plugin is enabled.',
						render: (st) => { st.addText((t) => t.setPlaceholder('Journal/daily').setValue(s.customFolder)
							.onChange((v) => { void this.applyChange((x) => { x.customFolder = v; }); })); },
					},
					{
						name: 'Custom date format',
						desc: 'Moment.js format of the note name, for example YYYY-MM-DD, or YYYY/MM/YYYY-MM-DD for notes in year/month folders.',
						render: (st) => { st.addText((t) => t.setPlaceholder('YYYY-MM-DD').setValue(s.customFormat)
							.onChange((v) => { void this.applyChange((x) => { x.customFormat = v; }); })); },
					},
				],
			},
			{ heading: 'Display', rows: display },
			this.licenseSection(),
		];
	}

	private licenseSection(): Section {
		const lic = this.plugin.license;
		if (FREE_BUILD || !lic.isConfigured()) {
			// Free-only build: no key field, no purchase link, no network.
			return {
				heading: 'Pro',
				rows: [{
					name: 'Streakwise Pro — coming soon',
					desc: 'Free version: yearly heatmap of one habit. Planned for Pro: month, week, quarter and '
						+ 'year-to-date views, multiple habits and PNG export.',
				}],
			};
		}
		this.keyDraft = lic.state.key;
		const status = lic.isPro()
			? `Pro unlocked (offline grace: ${lic.graceDaysLeft()} day(s) left).`
			: lic.state.status === 'invalid' ? 'Pro locked.' : 'Free version: yearly heatmap of one habit.';
		return {
			heading: 'Pro license',
			rows: [
				{ name: 'Status', desc: lic.state.message ? `${status} ${lic.state.message}` : status },
				{
					name: 'License key',
					desc: 'Pro adds month, week, quarter and year-to-date views, multiple habits and PNG export. '
						+ (this.plugin.keyStore.kind === 'keychain'
							? 'The key is stored in Obsidian Keychain, not in your vault files. '
							: 'The key is stored in this plugin\'s data.json in your vault. ')
						+ 'It is sent only to Polar (api.polar.sh) to verify it, and only when you press Activate or once a day afterwards.',
					render: (st) => { st
						.addText((t) => {
							t.inputEl.type = 'password';
							t.setPlaceholder('License key').setValue(this.keyDraft)
								.onChange((v) => { this.keyDraft = v; });
						})
						.addButton((b) => b.setButtonText('Activate').setCta().onClick(async () => {
							b.setDisabled(true);
							await lic.activate(this.keyDraft, 'Obsidian');
							this.refresh();
						}))
						.addButton((b) => b.setButtonText('Remove').onClick(async () => {
							await lic.clear();
							this.refresh();
						})); },
				},
			],
		};
	}
}
