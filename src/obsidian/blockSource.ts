import { App, MarkdownPostProcessorContext, Notice, TFile } from 'obsidian';

/**
 * Rewrites the lines inside one ```streakwise block, and nothing else in the note.
 * The change is applied only if those lines still read exactly as the block that was rendered,
 * so a note edited in the meantime (or a block inside a quote or callout) is never touched.
 */
export async function rewriteBlock(app: App, ctx: MarkdownPostProcessorContext, el: HTMLElement, rendered: string, next: string): Promise<boolean> {
	const info = ctx.getSectionInfo(el);
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!info || !(file instanceof TFile)) {
		new Notice('Streakwise could not change this block automatically. Edit the block to apply it.');
		return false;
	}
	const norm = (t: string) => t.replace(/\r/g, '').replace(/\n+$/, '');
	let ok = false;
	await app.vault.process(file, (data) => {
		const eol = data.includes('\r\n') ? '\r\n' : '\n';
		const lines = data.split(/\r?\n/);
		const inner = lines.slice(info.lineStart + 1, info.lineEnd);
		if (norm(inner.join('\n')) !== norm(rendered)) return data;
		lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...norm(next).split('\n'));
		ok = true;
		return lines.join(eol);
	});
	if (!ok) new Notice('This block changed since it was drawn. Nothing was edited; try again.');
	return ok;
}
