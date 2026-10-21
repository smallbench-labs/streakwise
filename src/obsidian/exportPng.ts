import { App, normalizePath } from 'obsidian';

/** Copies computed styles onto the clone so the exported image looks like the screen (theme colours, fonts). */
function inlineStyles(source: Element, target: Element) {
	const cs = getComputedStyle(source);
	const style = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight']
		.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
	target.setAttribute('style', style);
	for (let i = 0; i < source.children.length; i++) {
		const s = source.children[i], t = target.children[i];
		if (s && t) inlineStyles(s, t);
	}
}

/** SVG -> PNG entirely in memory (no network): serialise, load as an image, draw on a canvas. */
export async function svgToPng(svg: SVGSVGElement, background: string, scale = 2): Promise<ArrayBuffer> {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	inlineStyles(svg, clone);
	clone.querySelectorAll('title').forEach((t) => t.remove());
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

	const width = Number(svg.getAttribute('width'));
	const height = Number(svg.getAttribute('height'));
	const data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));

	const img = new Image();
	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error('Could not render SVG'));
		img.src = data;
	});

	const canvas = createEl('canvas');
	canvas.width = width * scale;
	canvas.height = height * scale;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas not available');
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('PNG encoding failed');
	return blob.arrayBuffer();
}

/** Saves into the vault, creating the folder if needed. Returns the new file path. */
export async function savePngToVault(app: App, folder: string, baseName: string, png: ArrayBuffer): Promise<string> {
	const dir = normalizePath(folder || '/');
	if (dir !== '/' && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
	let path = normalizePath(`${dir === '/' ? '' : dir + '/'}${baseName}.png`);
	for (let i = 2; app.vault.getAbstractFileByPath(path); i++) {
		path = normalizePath(`${dir === '/' ? '' : dir + '/'}${baseName}-${i}.png`);
	}
	await app.vault.createBinary(path, png);
	return path;
}
