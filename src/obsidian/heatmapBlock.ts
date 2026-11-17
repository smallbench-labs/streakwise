import { moreDays } from '../core/plural';
import { Keymap, MarkdownPostProcessorContext, MarkdownRenderChild, Menu, Notice, setIcon } from 'obsidian';
import { todayKey } from './time';
import type StreakwisePlugin from '../main';
import { applyFreeLimits, parseBlockConfig } from '../core/blockConfig';
import { buildHeatmapModel } from '../core/heatmapModel';
import { DedupedEntries, duplicatesInRange } from '../core/dailyEntries';
import { DailySource, habitValues, resolveDailySource } from './dataSource';
import { formatDailyNoteName } from '../core/noteDates';
import { fitToContent, renderExportSvg, renderGridSvg, renderLegendSwatches, renderMarkSwatch, renderWeekdayAxis } from './renderSvg';
import type { HeatmapModel } from '../core/heatmapModel';
import type { Palette } from '../core/blockConfig';
import { savePngToVault, svgToPng } from './exportPng';
import { discoverProperties, habitLabel, replaceHabitInSource, setRuleInSource } from '../core/discover';
import { StreakRule, computeFlex, isClassicRule, ruleLabel, ruleLines, unitCount } from '../core/rules';
import { renderSummary } from '../ui/summary';
import { FlexPreviewModal } from '../ui/modals';
import { rewriteBlock } from './blockSource';
import { openOrOfferDailyNote } from './dailyNote';

/** One sentence on what Pro adds; shared by the locked notes so the pitch stays consistent. */
export const PRO_SUMMARY = 'Pro adds flexible streaks (a weekly goal, weekdays only, rest days, freezes), month, week, quarter and year-to-date views, several habits in one block, and PNG export.';

/**
 * One rendered ```streakwise block. The plugin re-renders all blocks (debounced) when notes change,
 * are created, deleted or renamed, or when settings / the license change.
 */
export class HeatmapBlock extends MarkdownRenderChild {
	private exportInput: { model: HeatmapModel; palette: Palette; title: string; view: string; today: string } | null = null;

	constructor(containerEl: HTMLElement, private readonly source: string, private readonly plugin: StreakwisePlugin, private readonly ctx: MarkdownPostProcessorContext | null = null) {
		super(containerEl);
	}

	onload() {
		this.plugin.blocks.add(this);
		this.render();
	}

	onunload() {
		this.plugin.blocks.delete(this);
	}

	render() {
		try {
			this.renderUnsafe();
		} catch (e) {
			// S-25: never leave a blank block; say why.
			this.containerEl.empty();
			this.containerEl.createDiv({ cls: 'sw-message sw-error', text: `Streakwise: could not render this block (${e instanceof Error ? e.message : String(e)})` });
		}
	}

	private renderUnsafe() {
		const { plugin } = this;
		const s = plugin.settings;
		const root = this.containerEl;
		root.empty();
		root.addClass('sw-block');
		this.exportInput = null;

		const source = resolveDailySource(plugin.app, s);
		const index = plugin.dailyIndex.get(source);
		const parsed = parseBlockConfig(this.source);
		if (parsed.habits.length === 0) parsed.habits = s.defaultHabit ? [s.defaultHabit] : [];
		if (parsed.habits.length === 0) {
			this.renderMissing(index, null);
			return;
		}

		const isPro = plugin.license.isPro();
		const proSoon = FREE_BUILD || !plugin.license.isConfigured();
		const { config, locked, lockedRule } = applyFreeLimits(parsed, isPro);
		const today = todayKey();
		const weekStart = config.weekStart ?? s.weekStart;
		const data = habitValues(index, config.habits);
		const model = buildHeatmapModel({
			view: config.view,
			anchor: config.anchor ?? today,
			today,
			weekStart,
			habits: config.habits,
			data,
			max: config.max,
			rule: config.rule,
		});

		for (const err of parsed.errors) root.createDiv({ cls: 'sw-message sw-error', text: err });
		if (locked.length) {
			this.renderLockedView(locked, proSoon);
			return;
		}

		// Empty state: one hint card per note, no empty grid. --text-error stays for real errors only.
		if (index.byDay.size === 0) {
			this.renderEmptyState(source.folder, source.format);
			return;
		}

		// A habit name that no daily note uses: say so and offer the properties that do exist (fix S-first-run).
		const missing = config.habits.filter((h) => (data.get(h)?.size ?? 0) === 0);
		if (missing.length === config.habits.length) {
			this.renderMissing(index, missing[0] ?? null);
			return;
		}
		for (const h of missing) this.renderMissing(index, h, true);

		const dups = duplicatesInRange(index.duplicates, model.range);
		if (dups.length) {
			const d = dups[0];
			const more = dups.length > 1 ? ` (and ${moreDays(dups.length - 1)})` : '';
			root.createDiv({
				cls: 'sw-message',
				text: `${d?.day}: more than one daily note${more}. Using "${d?.used}"; ignoring ${d?.ignored.join(', ')}.`,
			});
		}

		const palette = config.palette ?? s.palette;
		const visible = model.habits.filter((h) => !missing.includes(h.habit));
		const single = visible.length === 1;
		const canExport = !proSoon && !parsed.errors.length;
		this.exportInput = canExport ? { model, palette, title: config.title, view: config.view, today } : null;

		// Header: block title (or the habit, for a single-habit block) and the block menu.
		const head = root.createDiv({ cls: 'sw-head' });
		const titleText = config.title || (single && visible[0] ? habitLabel(visible[0].habit) : '');
		head.createDiv({ cls: 'sw-title', text: titleText });
		const menuBtn = head.createEl('button', { cls: 'clickable-icon sw-menu-btn', attr: { 'aria-label': 'Streakwise options' } });
		setIcon(menuBtn, 'more-horizontal');
		const first = visible[0];
		this.registerDomEvent(menuBtn, 'click', (evt) => {
			this.openMenu(evt, { isPro, proSoon, canExport, today, weekStart, source, index,
				habit: first?.habit ?? '', values: first ? (data.get(first.habit) ?? new Map<string, number>()) : new Map<string, number>(), rule: config.rule });
		});

		if (lockedRule && first) this.renderRulePreview(lockedRule, data.get(first.habit) ?? new Map<string, number>(), today, weekStart, first.flex.current, proSoon);

		// Layout (S-11): summary and legend are HTML so they wrap in narrow panes; only the grid scrolls.
		for (const habit of visible) {
			renderSummary(root, model, habit, today, !single || !!config.title);
			// Weekday labels stay put; only the cells (and month labels) scroll.
			const row = root.createDiv({ cls: 'sw-grid-row' });
			const axis = renderWeekdayAxis(model);
			if (axis) row.appendChild(axis);
			const scroll = row.createDiv({ cls: 'sw-scroll-wrap' }).createDiv({ cls: 'sw-scroll' });
			scroll.appendChild(renderGridSvg(model, habit, palette, today));
			this.registerDomEvent(scroll, 'click', (evt) => {
				const cell = (evt.target as Element | null)?.closest?.('rect[data-day]');
				const day = cell?.getAttribute('data-day');
				if (day) void openOrOfferDailyNote(plugin.app, day, index.byDay.get(day)?.path, source, Keymap.isModEvent(evt), today);
			});
			this.scrollToToday(scroll, today);
		}
		const legend = root.createDiv({ cls: 'sw-legend', attr: { role: 'img', 'aria-label': 'Colour scale: lighter is less, stronger is more' } });
		legend.createSpan({ text: 'Less', attr: { 'aria-hidden': 'true' } });
		legend.appendChild(renderLegendSwatches(palette));
		legend.createSpan({ text: 'More', attr: { 'aria-hidden': 'true' } });
		if (!isClassicRule(config.rule)) {
			if (config.rule.days !== null) {
				const rest = legend.createSpan({ cls: 'sw-legend-mark' });
				rest.appendChild(renderMarkSwatch('rest', palette));
				rest.appendText('Rest day');
			}
			if (config.rule.freezesPerMonth > 0) {
				const frozen = legend.createSpan({ cls: 'sw-legend-mark' });
				frozen.appendChild(renderMarkSwatch('frozen', palette));
				frozen.appendText('Freeze used');
			}
		}
	}

	private openMenu(evt: MouseEvent, o: {
		isPro: boolean; proSoon: boolean; canExport: boolean; today: string; weekStart: 0 | 1; source: DailySource; index: DedupedEntries;
		habit: string; values: Map<string, number>; rule: StreakRule;
	}) {
		const { plugin } = this;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Open today\'s daily note').setIcon('calendar-check').onClick(() => {
			void openOrOfferDailyNote(plugin.app, o.today, o.index.byDay.get(o.today)?.path, o.source, false, o.today);
		}));
		if (o.habit) {
			menu.addItem((i) => i.setTitle(o.isPro ? 'Flexible streak…' : 'Preview a flexible streak').setIcon('flame').onClick(() => {
				new FlexPreviewModal(plugin.app, {
					habit: o.habit, values: o.values, today: o.today, weekStart: o.weekStart, current: o.rule, proSoon: o.proSoon,
					onApply: o.isPro ? (rule) => { void this.applyRule(rule); } : null,
					onLearnMore: () => plugin.openSettings(),
				}).open();
			}));
		}
		// Free-only build: no export at all (esbuild drops this block).
		if (!FREE_BUILD && !o.proSoon) {
			menu.addSeparator();
			menu.addItem((i) => {
				i.setTitle(o.isPro ? 'Export as PNG' : 'Export as PNG (Pro)').setIcon('image-down');
				if (!o.canExport) i.setDisabled(true);
				i.onClick(() => {
					if (o.isPro) void this.exportPng();
					else plugin.openSettings();
				});
			});
		}
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Streakwise settings').setIcon('settings').onClick(() => plugin.openSettings()));
		menu.showAtMouseEvent(evt);
	}

	private async applyRule(rule: StreakRule) {
		if (!this.ctx) return;
		await rewriteBlock(this.plugin.app, this.ctx, this.containerEl, this.source, setRuleInSource(this.source, ruleLines(rule)));
	}

	/** Free block that asks for a flexible streak: draw the free heatmap and show what the rule would give, from real notes. */
	private renderRulePreview(rule: StreakRule, values: Map<string, number>, today: string, weekStart: 0 | 1, classicCurrent: number, proSoon: boolean) {
		const res = computeFlex(values, rule, today, weekStart);
		const card = this.containerEl.createDiv({ cls: 'sw-pro-card' });
		const head = card.createDiv({ cls: 'sw-pro-card-head' });
		setIcon(head.createSpan({ cls: 'sw-pro-icon', attr: { 'aria-hidden': 'true' } }), 'flame');
		head.createSpan({ cls: 'sw-pro-card-title', text: `Flexible streak · ${ruleLabel(rule)}` });
		head.createSpan({ cls: 'sw-pro-badge', text: 'Pro' });
		const body = card.createDiv({ cls: 'sw-pro-card-body' });
		body.appendText('With this rule, your streak would be ');
		body.createEl('strong', { text: unitCount(res.current, res.unit) });
		body.appendText(` (best ${unitCount(res.longest, res.unit)}). Counting every day, it is ${unitCount(classicCurrent, 'day')}.`);
		const actions = card.createDiv({ cls: 'sw-pro-card-actions' });
		const btn = actions.createEl('button', { cls: 'mod-cta', text: proSoon ? 'Open settings' : 'See Streakwise Pro' });
		this.registerDomEvent(btn, 'click', () => this.plugin.openSettings());
		actions.createSpan({ cls: 'sw-pro-card-note', text: proSoon ? 'Flexible streaks are coming to Pro.' : 'Calculated from your own notes. Nothing is sent anywhere.' });
	}

	/** A view or several habits were requested in the free version: say what Pro adds, without a second copy of the free heatmap. */
	private renderLockedView(locked: string[], proSoon: boolean) {
		const card = this.containerEl.createDiv({ cls: 'sw-pro-card' });
		const head = card.createDiv({ cls: 'sw-pro-card-head' });
		setIcon(head.createSpan({ cls: 'sw-pro-icon', attr: { 'aria-hidden': 'true' } }), 'lock');
		const what = locked.join(' and ');
		head.createSpan({ cls: 'sw-pro-card-title', text: proSoon ? `${what}: planned for Streakwise Pro` : `${what}: part of Streakwise Pro` });
		card.createDiv({ cls: 'sw-pro-card-body', text: PRO_SUMMARY });
		const actions = card.createDiv({ cls: 'sw-pro-card-actions' });
		const btn = actions.createEl('button', { cls: 'mod-cta', text: proSoon ? 'Open settings' : 'See Streakwise Pro' });
		this.registerDomEvent(btn, 'click', () => this.plugin.openSettings());
	}

	/**
	 * No usable habit: none set, or no daily note has it. Lists the properties the daily notes do have;
	 * selecting one rewrites only the habits line of this block. `inline` = one line above the grid (multi-habit block).
	 */
	private renderMissing(index: DedupedEntries, habit: string | null, inline = false) {
		const found = discoverProperties(index, 6).filter((p) => p.name.toLowerCase() !== habit?.toLowerCase());
		const card = this.containerEl.createDiv({ cls: inline ? 'sw-message sw-missing-inline' : 'sw-empty-card' });
		if (!inline) card.createDiv({ cls: 'sw-empty-title', text: habit ? `No daily note has “${habit}” yet` : 'Pick a habit to track' });
		const desc = card.createDiv({ cls: inline ? '' : 'sw-empty-desc' });
		if (inline && habit) desc.appendText(`No daily note has “${habit}” yet. `);
		if (found.length) {
			desc.appendText(inline ? 'Found: ' : 'Your daily notes have these properties. Select one to use it here:');
			const chips = card.createDiv({ cls: 'sw-chips' });
			for (const p of found) {
				const chip = chips.createEl('button', { cls: 'sw-chip' });
				chip.createSpan({ text: p.name });
				chip.createSpan({ cls: 'sw-chip-count', text: String(p.notes) });
				chip.setAttr('aria-label', `Use ${p.name} (in ${p.notes} daily notes)`);
				this.registerDomEvent(chip, 'click', () => {
					if (!this.ctx) return;
					void rewriteBlock(this.plugin.app, this.ctx, this.containerEl, this.source, replaceHabitInSource(this.source, habit ?? '', p.name));
				});
			}
		} else if (!inline) {
			desc.appendText('Add a property to your daily notes, for example ');
			desc.createEl('code', { text: 'exercise: true' });
			desc.appendText(' or ');
			desc.createEl('code', { text: 'reading: 30' });
			desc.appendText(', then this heatmap fills in by itself.');
		}
	}

	/** Hint card shown once per note; later blocks in the same note get a one-line pointer. */
	private renderEmptyState(folder: string, format: string) {
		const root = this.containerEl;
		const view = root.closest('.markdown-preview-view, .markdown-source-view, .markdown-rendered');
		const first = view?.querySelector('.sw-empty-card');
		if (first && !root.contains(first)) {
			root.createDiv({ cls: 'sw-message', text: 'No daily notes found yet (see the first heatmap in this note).' });
			return;
		}
		const card = root.createDiv({ cls: 'sw-empty-card' });
		card.createDiv({ cls: 'sw-empty-title', text: 'No daily notes found yet' });
		const desc = card.createDiv({ cls: 'sw-empty-desc' });
		desc.appendText('Streakwise looks in ');
		if (folder) {
			desc.appendText('the folder ');
			desc.createEl('code', { text: folder });
		} else desc.appendText('your vault root');
		desc.appendText(' and its subfolders for notes named like ');
		desc.createEl('code', { text: formatDailyNoteName(todayKey(), format) });
		desc.appendText(` (format ${format})`);
		desc.appendText('. Create a daily note, or change the location in settings.');
		const btn = card.createEl('button', { text: 'Open Streakwise settings' });
		btn.onclick = () => { this.plugin.openSettings(); };
	}

	/**
	 * Narrow panes: right-align today's column and show fades on edges that can scroll.
	 * Re-aligns when the pane is resized, unless the user has scrolled the grid themselves.
	 */
	private scrollToToday(scroll: HTMLElement, today: string) {
		let userScrolled = false;
		let ours = false;
		const update = () => {
			const max = scroll.scrollWidth - scroll.clientWidth;
			const wrap = scroll.parentElement;
			wrap?.toggleClass('sw-fade-left', scroll.scrollLeft > 1);
			wrap?.toggleClass('sw-fade-right', scroll.scrollLeft < max - 1);
		};
		const align = () => {
			const cell = scroll.querySelector(`rect[data-day="${today}"]`);
			if (cell && scroll.scrollWidth > scroll.clientWidth) {
				const c = cell.getBoundingClientRect(), b = scroll.getBoundingClientRect();
				ours = true;
				scroll.scrollLeft += c.right - b.right + 40; // keep today clear of the 24px edge fade
			}
			update();
		};
		scroll.addEventListener('scroll', () => {
			if (ours) ours = false; else userScrolled = true;
			update();
		}, { passive: true });
		let lastWidth = 0;
		const ro = new ResizeObserver(() => {
			if (scroll.clientWidth === lastWidth) return;
			lastWidth = scroll.clientWidth;
			if (userScrolled) update(); else align();
		});
		ro.observe(scroll);
		this.register(() => ro.disconnect());
		window.requestAnimationFrame(align);
	}

	async exportPng(): Promise<string | null> {
		if (!this.exportInput || !this.plugin.license.isPro()) return null;
		const { model, palette, title, view, today } = this.exportInput;
		// Attach off-screen inside the block so theme CSS applies, then measure real text widths.
		const svg = renderExportSvg(model, palette, title, today);
		const holder = this.containerEl.createDiv({ cls: 'sw-export-holder' });
		holder.appendChild(svg);
		try {
			fitToContent(svg);
			const bg = getComputedStyle(this.containerEl).getPropertyValue('--background-primary').trim() || '#ffffff';
			const png = await svgToPng(svg, bg);
			const path = await savePngToVault(this.plugin.app, this.plugin.settings.exportFolder, `streakwise-${view}-${today}`, png);
			new Notice(`Saved ${path}`);
			return path;
		} catch (e) {
			new Notice(`Streakwise export failed: ${(e as Error).message}`);
			return null;
		} finally {
			holder.remove();
		}
	}
}
