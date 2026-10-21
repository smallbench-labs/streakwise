import { MarkdownRenderChild, Notice, moment } from 'obsidian';
import type StreakwisePlugin from '../main';
import { applyFreeLimits, parseBlockConfig } from '../core/blockConfig';
import { buildHeatmapModel } from '../core/heatmapModel';
import { duplicatesInRange } from '../core/dailyEntries';
import { habitValues, resolveDailySource } from './dataSource';
import { fitToContent, renderExportSvg, renderGridSvg, renderLegendSwatches, statsLine } from './renderSvg';
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
			root.createDiv({
				cls: 'sw-message sw-locked',
				text: `${locked.join(', ')}: Streakwise Pro feature. Showing the free yearly view of "${config.habits[0]}".`,
			});
		}

		if (index.byDay.size === 0) {
			root.createDiv({
				cls: 'sw-message sw-error',
				text: `No daily notes found in "${source.folder || '/'}" (and its subfolders) with date format ${source.format}, from ${source.origin}. Check the daily notes location in Streakwise settings.`,
			});
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
			root.createDiv({ cls: 'sw-stats', text: statsLine(habit) });
			root.createDiv({ cls: 'sw-scroll' }).appendChild(renderGridSvg(model, habit, palette));
		}
		const legend = root.createDiv({ cls: 'sw-legend' });
		legend.createSpan({ text: 'Less' });
		legend.appendChild(renderLegendSwatches(palette));
		legend.createSpan({ text: 'More' });
		this.exportInput = { model, palette, title: config.title };

		// No export on blocks with config errors or locked features: the image would not match the request.
		if (parsed.errors.length || locked.length) return;
		const toolbar = root.createDiv({ cls: 'sw-toolbar' });
		const exportBtn = toolbar.createEl('button', { text: isPro ? 'Export PNG' : 'Export PNG (Pro)' });
		exportBtn.setAttr('aria-label', isPro ? 'Export this heatmap as a PNG into your vault' : 'Exporting PNG requires Streakwise Pro');
		exportBtn.disabled = !isPro;
		exportBtn.onclick = () => { void this.exportPng(config.view, today); };
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
