import { MarkdownRenderChild, Notice, moment, setIcon } from 'obsidian';
import type StreakwisePlugin from '../main';
import { applyFreeLimits, parseBlockConfig } from '../core/blockConfig';
import { buildHeatmapModel } from '../core/heatmapModel';
import { duplicatesInRange } from '../core/dailyEntries';
import { habitValues, resolveDailySource } from './dataSource';
import { formatDailyNoteName } from '../core/noteDates';
import { fitToContent, renderExportSvg, renderGridSvg, renderLegendSwatches, renderStats, renderWeekdayAxis } from './renderSvg';
import type { HeatmapModel } from '../core/heatmapModel';
import type { Palette } from '../core/blockConfig';
import { savePngToVault, svgToPng } from './exportPng';

/**
 * One rendered ```streakwise block. The plugin re-renders all blocks (debounced) when notes change,
 * are created, deleted or renamed, or when settings / the license change.
 */
export class HeatmapBlock extends MarkdownRenderChild {
	private exportInput: { model: HeatmapModel; palette: Palette; title: string } | null = null;

	constructor(containerEl: HTMLElement, private readonly source: string, private readonly plugin: StreakwisePlugin) {
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

		const parsed = parseBlockConfig(this.source);
		if (parsed.habits.length === 0) parsed.habits = s.defaultHabit ? [s.defaultHabit] : [];
		if (parsed.habits.length === 0) {
			root.createDiv({ cls: 'sw-message', text: 'Streakwise: add a line like "habits: run" to this block, or set a default habit in settings.' });
			return;
		}

		const isPro = plugin.license.isPro();
		const proSoon = !plugin.license.isConfigured();
		const { config, locked } = applyFreeLimits(parsed, isPro);
		const today = moment().format('YYYY-MM-DD');
		const source = resolveDailySource(plugin.app, s);
		const index = plugin.dailyIndex.get(source);
		const data = habitValues(index, config.habits);
		const model = buildHeatmapModel({
			view: config.view,
			anchor: config.anchor ?? today,
			today,
			weekStart: config.weekStart ?? s.weekStart,
			habits: config.habits,
			data,
			max: config.max,
		});

		for (const err of parsed.errors) root.createDiv({ cls: 'sw-message sw-error', text: err });
		if (locked.length) {
			// Callout only, no fallback grid: a second copy of the yearly heatmap in the same note is noise.
			const callout = root.createDiv({ cls: 'sw-message sw-locked' });
			setIcon(callout.createSpan({ cls: 'sw-locked-icon', attr: { 'aria-hidden': 'true' } }), 'lock');
			const what = locked.join(' and ');
			const verb = locked.length > 1 ? 'are' : 'is';
			callout.createSpan({
				text: proSoon
					? `${what} ${verb} planned for Pro. In the free version, use one habit with "view: year".`
					: `${what} ${verb} a Streakwise Pro feature. In the free version, use one habit with "view: year".`,
			});
			return;
		}

		// Empty state: one hint card per note, no empty grid. --text-error stays for real errors only.
		if (index.byDay.size === 0) {
			this.renderEmptyState(source.folder, source.format);
			return;
		}
		const dups = duplicatesInRange(index.duplicates, model.range);
		if (dups.length) {
			const d = dups[0];
			const more = dups.length > 1 ? ` (and ${dups.length - 1} more day(s))` : '';
			root.createDiv({
				cls: 'sw-message',
				text: `${d?.day}: more than one daily note${more}. Using "${d?.used}"; ignoring ${d?.ignored.join(', ')}.`,
			});
		}

		// Layout (S-11): title, stats and legend are HTML so they wrap in narrow panes;
		// only the grid itself scrolls horizontally.
		const palette = config.palette ?? s.palette;
		if (config.title) root.createDiv({ cls: 'sw-title', text: config.title });
		for (const habit of model.habits) {
			renderStats(root, habit);
			// Weekday labels stay put; only the cells (and month labels) scroll.
			const row = root.createDiv({ cls: 'sw-grid-row' });
			const axis = renderWeekdayAxis(model);
			if (axis) row.appendChild(axis);
			const scroll = row.createDiv({ cls: 'sw-scroll-wrap' }).createDiv({ cls: 'sw-scroll' });
			scroll.appendChild(renderGridSvg(model, habit, palette));
			this.scrollToToday(scroll, today);
		}
		const legend = root.createDiv({ cls: 'sw-legend', attr: { role: 'img', 'aria-label': 'Colour scale: lighter is less, stronger is more' } });
		legend.createSpan({ text: 'Less', attr: { 'aria-hidden': 'true' } });
		legend.appendChild(renderLegendSwatches(palette));
		legend.createSpan({ text: 'More', attr: { 'aria-hidden': 'true' } });
		this.exportInput = { model, palette, title: config.title };

		// No export on blocks with config errors or locked features: the image would not match the request.
		// Free build (or no Polar setup): no export button at all.
		if (FREE_BUILD || proSoon || parsed.errors.length || locked.length) return;
		const toolbar = root.createDiv({ cls: 'sw-toolbar' });
		const exportBtn = toolbar.createEl('button', { text: isPro ? 'Export PNG' : 'Export PNG (Pro)' });
		exportBtn.setAttr('aria-label', isPro ? 'Export this heatmap as a PNG into your vault' : 'Exporting PNG requires Streakwise Pro');
		exportBtn.disabled = !isPro;
		exportBtn.onclick = () => { void this.exportPng(config.view, today); };
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
		desc.createEl('code', { text: formatDailyNoteName(moment().format('YYYY-MM-DD'), format) });
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

	async exportPng(view: string, today: string): Promise<string | null> {
		if (!this.exportInput || !this.plugin.license.isPro()) return null;
		const { model, palette, title } = this.exportInput;
		// Attach off-screen inside the block so theme CSS applies, then measure real text widths.
		const svg = renderExportSvg(model, palette, title);
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
