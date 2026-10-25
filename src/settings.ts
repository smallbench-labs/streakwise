import { App, PluginSettingTab, Setting } from 'obsidian';
import type StreakwisePlugin from './main';
import { EMPTY_LICENSE, LicenseCache } from './license/types';
import { CHECKOUT_URL, HttpGetJson } from './license/checkout';
import { BuyGate } from './license/buyGate';
import { ConsentState, openCheckoutIfConsented } from './license/consent';
import { buildConsentBlock } from './license/consentUi';
import { obsidianHttpGetJson } from './license/obsidianHttp';
import { PALETTES, Palette } from './core/blockConfig';
import { WeekStart } from './core/dates';
import { moreDays } from './core/plural';
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
	/** Declarative `visible` predicate (1.13+); display() applies it by hiding the row. */
	visible?: () => boolean;
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
	visible?: () => boolean;
}
interface GroupDefinition {
	type: 'group';
	heading: string;
	items: RowDefinition[];
}

export class StreakwiseSettingTab extends PluginSettingTab {
	private keyDraft = '';
	/** Region GET; overridable in tests. */
	regionGet: HttpGetJson | null = null;
	private buyGate: BuyGate | null = null;
	/** Legacy display() path: the drawn Buy row, toggled directly when the region is known. */
	private legacyBuyEl: HTMLElement | null = null;
	/** Legacy display() path: the "couldn't check your region" note row. */
	private legacyRegionNoteEl: HTMLElement | null = null;
	/** Legacy display() path: the "Checking region…" row. */
	private legacyCheckingEl: HTMLElement | null = null;

	constructor(app: App, private plugin: StreakwisePlugin) {
		super(app, plugin);
	}

	private buyVisible(): boolean {
		return this.buyGate?.visible() ?? false;
	}

	/** Purchase consent; recreated (unchecked) every time the Pro panel is drawn, never saved. */
	private consent: ConsentState | null = null;

	/** Buy Pro click handler: refuses (returns false) unless the consent box is checked. */
	openCheckout(): boolean {
		return this.checkoutHandler?.() ?? false;
	}

	/** Set inside the !FREE_BUILD block only, so the free bundle has no checkout/consent code. */
	private checkoutHandler: (() => boolean) | null = null;

	private regionChecking(): boolean {
		return (this.buyGate?.current ?? 'unknown') === 'unknown';
	}

	private regionFailed(): boolean {
		return this.buyGate?.failed() ?? false;
	}

	/** Region known: re-evaluate visibility. 1.13+: refreshDomState() (or update()); legacy: toggle the row. */
	private onRegionSettled() {
		if (hasDeclarativeSettings(PluginSettingTab.prototype)) {
			const self = this as unknown as { refreshDomState?: () => void };
			if (typeof self.refreshDomState === 'function') self.refreshDomState();
			else this.refresh();
		} else if (this.legacyBuyEl) {
			if (this.buyVisible()) this.legacyBuyEl.show(); else this.legacyBuyEl.hide();
		}
		if (!hasDeclarativeSettings(PluginSettingTab.prototype) && this.legacyRegionNoteEl) {
			if (this.regionFailed()) this.legacyRegionNoteEl.show(); else this.legacyRegionNoteEl.hide();
		}
		if (!hasDeclarativeSettings(PluginSettingTab.prototype) && this.legacyCheckingEl) {
			if (this.regionChecking()) this.legacyCheckingEl.show(); else this.legacyCheckingEl.hide();
		}
	}

	hide(): void {
		// Next time the tab opens, check the region again.
		this.buyGate?.reset();
		this.legacyBuyEl = null;
		this.legacyRegionNoteEl = null;
		this.legacyCheckingEl = null;
		this.consent = null;
		super.hide();
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
				if (r.visible) def.visible = r.visible;
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
				if (r.visible && !r.visible()) setting.settingEl.hide();
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
				render: (st) => { st.addText((t) => t.setPlaceholder('Exercise').setValue(s.defaultHabit)
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
							.addOption('auto', 'Follow the daily notes or periodic notes plugin')
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
		// Explicit block (not just an early return) so esbuild drops this code from FREE_BUILD bundles.
		if (!FREE_BUILD && lic.isConfigured()) {
			this.keyDraft = lic.state.key;
			const status = lic.isPro()
				? `Pro is active. Works offline for ${moreDays(lic.graceDaysLeft())}.`
				: lic.state.status === 'invalid' ? 'Pro is locked: this key isn\'t active.' : 'You\'re on the free version (yearly heatmap, one habit per block).';
			const needsBuy = !lic.isPro();
			// Referenced only inside this !FREE_BUILD block so the free bundle has no network code.
			const gate = this.buyGate ?? (this.buyGate = new BuyGate(this.regionGet ?? obsidianHttpGetJson));
			const rows: Row[] = [{
				name: 'Status',
				desc: lic.state.message ? `${status} ${lic.state.message}` : status,
				// The region check starts only when the Pro panel is actually drawn (never during search indexing).
				render: needsBuy ? () => { void gate.ensure(() => this.onRegionSettled()); } : undefined,
			}];
			// m-01: a user who already has a key (e.g. device released) needs Activate first; Buy Pro goes below it.
			const keyFirst = !!lic.state.key;
			const buyRows: Row[] = [];
			if (needsBuy) {
				// S-34: hidden until the region is known; shown if the request fails; hidden if blocked.
				buyRows.push({
					name: 'Get Streakwise Pro',
					desc: 'Month, week, quarter and YTD views, several habits per block, PNG export. '
						+ 'US$19 once (plus tax), all future updates, 5 devices, 14-day refund; not available in Japan (see README).',
					visible: () => this.buyVisible(),
					render: (st) => {
						const consent = this.consent = new ConsentState();
						this.checkoutHandler = () => openCheckoutIfConsented(consent, CHECKOUT_URL, (u) => { window.open(u); });
						const infoEl = (st as unknown as { infoEl?: HTMLElement }).infoEl ?? st.settingEl;
						buildConsentBlock(infoEl, consent, () => this.openCheckout(), (u) => { window.open(u); });
						this.legacyBuyEl = st.settingEl;
					},
				});
				buyRows.push({
					name: 'Checking region…',
					visible: () => this.regionChecking(),
					render: (st) => { this.legacyCheckingEl = st.settingEl; },
				});
				buyRows.push({
					name: 'Streakwise Pro',
					desc: 'Couldn\'t check your region. Reopen settings later to try again.',
					visible: () => this.regionFailed(),
					render: (st) => { this.legacyRegionNoteEl = st.settingEl; },
				});
			}
			if (!keyFirst) rows.push(...buyRows);
			if (this.plugin.deviceCode) {
				rows.push({
					name: 'This device',
					desc: `Device code ${this.plugin.deviceCode}. In the Polar customer portal this device is listed as "${this.plugin.deviceLabel}".`,
				});
			}
			rows.push({
				name: 'License key',
				desc: 'Pro adds month, week, quarter and year-to-date views, multiple habits and PNG export. '
					+ (this.plugin.keyStore.kind === 'keychain'
						? 'The key is stored in Obsidian Keychain, not in your vault files. '
						: '⚠ Your Obsidian version has no Keychain, so the key is stored in plain text in this plugin\'s data.json in your vault. '
							+ 'If your vault is synced or kept in git, the key goes with it. Update Obsidian to 1.11.4 or later to keep it in Keychain. ')
					+ 'It is sent only to Polar (api.polar.sh): when you press Activate or Remove, then at most once a day, or on every startup while a stored key isn\'t unlocking Pro. '
					+ 'On a new device, paste the key and press Activate; it does not activate by itself. Up to 5 devices; to free one, deactivate it in the Polar customer portal.',
				render: (st) => {
					st.addText((t) => {
						t.inputEl.type = 'password';
						t.setPlaceholder('License key').setValue(this.keyDraft)
							.onChange((v) => { this.keyDraft = v; });
					})
						.addButton((b) => b.setButtonText('Activate').setCta().onClick(async () => {
							b.setDisabled(true);
							await lic.activate(this.keyDraft, '');
							this.refresh();
						}))
						.addButton((b) => b.setButtonText('Remove').onClick(async () => {
							await lic.clear();
							this.refresh();
						}));
				},
			});
			if (keyFirst) rows.push(...buyRows);
			return { heading: 'Pro license', rows };
		}
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
}
