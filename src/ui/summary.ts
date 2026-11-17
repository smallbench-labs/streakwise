import { HabitHeatmap, HeatmapModel } from '../core/heatmapModel';
import { habitLabel } from '../core/discover';
import { isClassicRule, ruleLabel, unitCount } from '../core/rules';
import { periodLabel, statsLine } from '../obsidian/renderSvg';

/**
 * The part people look at first: the current streak as a big number, this week at a glance,
 * then one quiet line of context. Plain HTML so it wraps in narrow panes.
 */
export function renderSummary(parent: HTMLElement, model: HeatmapModel, h: HabitHeatmap, today: string, showName: boolean) {
	const f = h.flex, s = h.stats;
	const box = parent.createDiv({ cls: 'sw-summary', attr: { 'aria-label': statsLine(h, model, today) } });
	if (showName) box.createDiv({ cls: 'sw-habit-name', text: habitLabel(h.habit) });

	const top = box.createDiv({ cls: 'sw-summary-top' });
	const hero = top.createDiv({ cls: 'sw-hero' });
	hero.createSpan({ cls: 'sw-hero-num', text: String(f.current) });
	hero.createSpan({ cls: 'sw-hero-unit', text: `${f.unit} streak` });

	const week = top.createDiv({ cls: 'sw-week' });
	const label = week.createDiv({ cls: 'sw-week-label' });
	label.createSpan({ text: 'This week' });
	label.createSpan({ cls: 'sw-week-count', text: `${f.week.done}/${f.week.target}` });
	const dots = week.createDiv({ cls: 'sw-week-dots', attr: { 'aria-hidden': 'true' } });
	if (f.unit === 'week') {
		// Weekly goal: one dot per required day, filled as the week fills up.
		for (let i = 0; i < f.week.target; i++) dots.createSpan({ cls: `sw-dot ${i < f.week.done ? 'sw-dot-done' : 'sw-dot-open'}` });
		if (f.week.done > f.week.target) dots.createSpan({ cls: 'sw-dot-extra', text: `+${f.week.done - f.week.target}` });
	} else {
		for (const d of f.week.days) {
			const dot = dots.createSpan({ cls: `sw-dot sw-dot-${d.state}` });
			dot.setAttr('title', `${d.day}: ${d.state}`);
		}
	}

	const pct = s.elapsedDays ? Math.round((s.doneDays / s.elapsedDays) * 100) : 0;
	const sub = box.createDiv({ cls: 'sw-sub' });
	sub.createSpan({ cls: 'sw-nowrap', text: `Best ${unitCount(f.longest, f.unit)}` });
	sub.createSpan({ cls: 'sw-sub-sep', text: ' · ' });
	if (!isClassicRule(h.rule)) {
		const rate = f.total ? Math.round((f.met / f.total) * 100) : 0;
		sub.createSpan({ cls: 'sw-nowrap', text: `${f.met} of ${unitCount(f.total, f.unit)} on plan (${rate}%)` });
		sub.createSpan({ cls: 'sw-sub-sep', text: ' · ' });
		sub.createSpan({ cls: 'sw-rule-chip', text: ruleLabel(h.rule) });
		if (h.rule.freezesPerMonth > 0) {
			sub.createSpan({ cls: 'sw-sub-sep', text: ' · ' });
			sub.createSpan({ cls: 'sw-nowrap', text: `${f.freezesLeft} ${f.freezesLeft === 1 ? 'freeze' : 'freezes'} left this month` });
		}
	} else {
		sub.createSpan({ cls: 'sw-nowrap', text: `${s.doneDays} of ${s.elapsedDays} days ${periodLabel(model, today)} (${pct}%)` });
	}
	if (f.nudge) box.createDiv({ cls: 'sw-nudge', text: f.nudge });
}
