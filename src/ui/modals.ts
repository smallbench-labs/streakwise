import { App, Modal, Setting, SuggestModal } from 'obsidian';
import { FoundProperty, habitLabel } from '../core/discover';
import { CLASSIC_RULE, PRESET_RULES, StreakRule, computeFlex, isClassicRule, ruleLabel, unitCount } from '../core/rules';
import type { DayKey, WeekStart } from '../core/dates';

/** "Insert heatmap block": choose one of the properties found in the daily notes. */
export class HabitPickerModal extends SuggestModal<FoundProperty> {
	constructor(app: App, private readonly found: FoundProperty[], private readonly onPick: (name: string) => void) {
		super(app);
		this.setPlaceholder('Which habit should the heatmap show?');
		this.setInstructions([{ command: '↵', purpose: 'insert heatmap' }, { command: 'esc', purpose: 'cancel' }]);
	}

	getSuggestions(query: string): FoundProperty[] {
		const q = query.trim().toLowerCase();
		const list = this.found.filter((p) => p.name.toLowerCase().includes(q));
		// Allow a property that isn't used yet: typing a new name offers it as the last option.
		if (q && !this.found.some((p) => p.name.toLowerCase() === q)) list.push({ name: query.trim(), notes: 0 });
		return list;
	}

	renderSuggestion(p: FoundProperty, el: HTMLElement) {
		el.createDiv({ text: habitLabel(p.name) });
		el.createDiv({ cls: 'sw-suggest-note', text: p.notes ? `${p.name} · in ${p.notes} daily ${p.notes === 1 ? 'note' : 'notes'}` : `${p.name} · not used in any daily note yet` });
	}

	onChooseSuggestion(p: FoundProperty) {
		this.onPick(p.name);
	}
}

export interface PreviewOptions {
	habit: string;
	values: Map<DayKey, number>;
	today: DayKey;
	weekStart: WeekStart;
	current: StreakRule;
	/** Pro: each row gets a "Use" button that writes the rule into the block. */
	onApply: ((rule: StreakRule) => void) | null;
	/** Free: "See Streakwise Pro" opens the plugin settings. */
	onLearnMore: (() => void) | null;
	proSoon: boolean;
}

/** Same notes, different rules: what the streak would be under each preset, from the user's own data. */
export class FlexPreviewModal extends Modal {
	constructor(app: App, private readonly o: PreviewOptions) {
		super(app);
	}

	onOpen() {
		const { o, contentEl } = this;
		this.titleEl.setText(`Flexible streaks for ${habitLabel(o.habit)}`);
		contentEl.addClass('sw-preview-modal');
		contentEl.createEl('p', { cls: 'sw-preview-lead', text: 'Real life has rest days. These numbers come from your own daily notes, with different rules applied.' });

		const rows: { label: string; rule: StreakRule; note?: string }[] = [
			{ label: 'Every day', rule: CLASSIC_RULE, note: isClassicRule(o.current) ? 'now' : undefined },
			...PRESET_RULES.map((p) => ({ ...p, note: ruleLabel(p.rule) === ruleLabel(o.current) && !isClassicRule(o.current) ? 'now' : undefined })),
		];
		const results = rows.map((r) => ({ ...r, res: computeFlex(o.values, r.rule, o.today, o.weekStart) }));
		const table = contentEl.createDiv({ cls: `sw-preview-table${o.onApply ? ' sw-with-actions' : ''}`, attr: { role: 'table' } });
		const head = table.createDiv({ cls: 'sw-preview-row sw-preview-head', attr: { role: 'row' } });
		for (const h of ['Rule', 'Current streak', 'Best', 'On plan']) head.createDiv({ text: h, attr: { role: 'columnheader' } });
		if (o.onApply) head.createDiv({ attr: { role: 'columnheader', 'aria-label': 'Action' } });
		for (const r of results) {
			const row = table.createDiv({ cls: 'sw-preview-row', attr: { role: 'row' } });
			const name = row.createDiv({ cls: 'sw-preview-rule', attr: { role: 'cell' } });
			name.appendText(r.label);
			if (r.note) name.createSpan({ cls: 'sw-preview-now', text: r.note });
			row.createDiv({ cls: 'sw-preview-num', text: unitCount(r.res.current, r.res.unit), attr: { role: 'cell' } });
			row.createDiv({ cls: 'sw-preview-num', text: unitCount(r.res.longest, r.res.unit), attr: { role: 'cell' } });
			const rate = r.res.total ? Math.round((r.res.met / r.res.total) * 100) : 0;
			row.createDiv({ cls: 'sw-preview-num sw-preview-muted', text: `${rate}%`, attr: { role: 'cell' } });
			if (o.onApply) {
				const cell = row.createDiv({ attr: { role: 'cell' } });
				if (!r.note) {
					const btn = cell.createEl('button', { text: 'Use' });
					btn.onclick = () => { this.close(); o.onApply?.(r.rule); };
				}
			}
		}

		const foot = contentEl.createDiv({ cls: 'sw-preview-foot' });
		foot.createEl('p', {
			cls: 'sw-preview-muted',
			text: 'A weekly goal counts your streak in weeks. Weekdays only skips weekends. A freeze covers one missed day, up to two a month, so one bad day doesn\'t erase a month of work.',
		});
		if (!o.onApply) {
			new Setting(foot)
				.setName(o.proSoon ? 'Flexible streaks are coming to Streakwise Pro' : 'Flexible streaks are part of Streakwise Pro')
				.setDesc('The yearly heatmap and the daily streak stay free.')
				.addButton((b) => {
					b.setButtonText(o.proSoon ? 'Open settings' : 'See Streakwise Pro').setCta().onClick(() => { this.close(); o.onLearnMore?.(); });
				});
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
