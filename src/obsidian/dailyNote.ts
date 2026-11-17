import { App, Modal, Notice, PaneType, Setting, TFile, TFolder, normalizePath } from 'obsidian';
import { formatDay, nowTime } from './time';
import type { DailySource } from './dataSource';
import { formatDailyNoteName } from '../core/noteDates';

interface TemplateOptions { template?: string; enabled?: boolean }
interface AppInternals {
	plugins?: { getPlugin?(id: string): { settings?: { daily?: TemplateOptions } } | null };
	internalPlugins?: { getPluginById?(id: string): { enabled?: boolean; instance?: { options?: TemplateOptions } } | null };
}

/** Template note configured in Periodic Notes or the core Daily notes plugin (whichever Streakwise follows). */
function templatePath(app: App, source: DailySource): string {
	const internals = app as unknown as AppInternals;
	if (source.origin === 'Periodic Notes') return internals.plugins?.getPlugin?.('periodic-notes')?.settings?.daily?.template ?? '';
	if (source.origin === 'Daily notes (core)') return internals.internalPlugins?.getPluginById?.('daily-notes')?.instance?.options?.template ?? '';
	return '';
}

/** The same placeholders the core Daily notes plugin fills in: {{date}}, {{date:FORMAT}}, {{time}}, {{title}}. */
export function fillTemplate(text: string, day: string, format: string, title: string, now: string): string {
	return text
		.replace(/{{\s*date\s*:\s*([^}]+?)\s*}}/gi, (_, f: string) => formatDay(day, f))
		.replace(/{{\s*date\s*}}/gi, formatDay(day, format))
		.replace(/{{\s*time\s*}}/gi, now)
		.replace(/{{\s*title\s*}}/gi, title);
}

async function ensureFolder(app: App, folder: string) {
	if (!folder || app.vault.getAbstractFileByPath(folder) instanceof TFolder) return;
	let path = '';
	for (const part of folder.split('/')) {
		path = path ? `${path}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
	}
}

async function createDailyNote(app: App, day: string, source: DailySource): Promise<TFile> {
	const name = formatDailyNoteName(day, source.format);
	const path = normalizePath(`${source.folder ? source.folder + '/' : ''}${name}.md`);
	await ensureFolder(app, path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
	let body = '';
	const tpl = templatePath(app, source).trim();
	if (tpl) {
		const tplFile = app.metadataCache.getFirstLinkpathDest(tpl.replace(/\.md$/, ''), '');
		if (tplFile) body = fillTemplate(await app.vault.cachedRead(tplFile), day, source.format, name.split('/').pop() ?? name, nowTime());
	}
	return app.vault.create(path, body);
}

class CreateNoteModal extends Modal {
	constructor(app: App, private readonly day: string, private readonly path: string, private readonly onCreate: () => void) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(`No daily note for ${formatDay(this.day, 'dddd, LL')}`);
		this.contentEl.createEl('p', { text: 'Create it now? It uses your daily note template, if you have one.' });
		this.contentEl.createEl('p', { cls: 'sw-modal-path', text: this.path });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Create note').setCta().onClick(() => { this.close(); this.onCreate(); }));
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * Click on a heatmap day: open that daily note (new tab with Ctrl/Cmd), or offer to create it.
 * Future days do nothing.
 */
export async function openOrOfferDailyNote(app: App, day: string, existingPath: string | undefined, source: DailySource, newTab: PaneType | boolean, today: string) {
	if (existingPath) {
		const file = app.vault.getAbstractFileByPath(existingPath);
		if (file instanceof TFile) { await app.workspace.getLeaf(newTab).openFile(file); return; }
	}
	if (day > today) return;
	const name = formatDailyNoteName(day, source.format);
	const path = normalizePath(`${source.folder ? source.folder + '/' : ''}${name}.md`);
	new CreateNoteModal(app, day, path, () => {
		void (async () => {
			try {
				const file = await createDailyNote(app, day, source);
				await app.workspace.getLeaf(newTab).openFile(file);
			} catch (e) {
				new Notice(`Streakwise could not create ${path}: ${(e as Error).message}`);
			}
		})();
	}).open();
}
