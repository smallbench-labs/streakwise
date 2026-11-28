// Tiny DOM stand-in with Obsidian's element helpers (createEl/createDiv/...), event bubbling,
// and native-like <label> behaviour (a click that reaches the label toggles its checkbox).
type Listener = (e: FakeEvent) => void;
export class FakeEvent {
	defaultPrevented = false;
	propagationStopped = false;
	constructor(public type: string, public target: FakeNode) {}
	preventDefault() { this.defaultPrevented = true; }
	stopPropagation() { this.propagationStopped = true; }
}
export let focused: FakeNode | null = null;
export function resetFocus() { focused = null; }
export class FakeNode {
	hidden = false;
	children: FakeNode[] = [];
	parentElement: FakeNode | null = null;
	attrs: Record<string, string> = {};
	classes = new Set<string>();
	text = '';
	checked = false;
	type = '';
	private listeners: Record<string, Listener[]> = {};
	constructor(public tag = 'div') {}
	hide() { this.hidden = true; }
	show() { this.hidden = false; }
	toggle(on: boolean) { this.hidden = !on; }
	empty() { this.children = []; }
	createEl(tag: string, o: { cls?: string; text?: string; type?: string; attr?: Record<string, string> } = {}) {
		const n = new FakeNode(tag);
		if (o.cls) for (const c of o.cls.split(' ')) n.classes.add(c);
		if (o.text) n.text = o.text;
		if (o.type) n.type = o.type;
		if (o.attr) Object.assign(n.attrs, o.attr);
		this.appendChild(n);
		return n;
	}
	createDiv(o?: { cls?: string; text?: string; attr?: Record<string, string> }) { return this.createEl('div', o); }
	createSpan(o?: { cls?: string; text?: string; attr?: Record<string, string> }) { return this.createEl('span', o); }
	appendText(t: string) { const n = new FakeNode('#text'); n.text = t; this.appendChild(n); }
	appendChild(n: FakeNode) { n.detach(); n.parentElement = this; this.children.push(n); return n; }
	detach() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; } }
	setAttr(k: string, v: string) { this.attrs[k] = v; }
	getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
	hasAttribute(k: string) { return k in this.attrs; }
	removeAttribute(k: string) { delete this.attrs[k]; }
	addClass(c: string) { this.classes.add(c); }
	removeClass(c: string) { this.classes.delete(c); }
	hasClass(c: string) { return this.classes.has(c); }
	didScrollIntoView = false;
	scrollIntoView(_opts?: unknown) { this.didScrollIntoView = true; }
	matchesSelector(sel: string): boolean {
		if (sel.startsWith('.')) return sel.slice(1).split('.').every((c) => this.classes.has(c));
		const [tag, ...cls] = sel.split('.').filter(Boolean);
		if (tag && this.tag.toLowerCase() !== tag.toLowerCase()) return false;
		return cls.every((c) => this.classes.has(c));
	}
	querySelector(sel: string): FakeNode | null { return this.find((n) => n.matchesSelector(sel)); }
	closest(sel: string): FakeNode | null {
		for (let n: FakeNode | null = this; n; n = n.parentElement) {
			if (n.matchesSelector(sel)) return n;
		}
		return null;
	}
	focus() { focused = this; }
	get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
	addEventListener(t: string, l: Listener) { (this.listeners[t] ??= []).push(l); }
	/** Click with bubbling; a click reaching a <label> toggles its checkbox like a browser. */
	click() {
		const e = new FakeEvent('click', this);
		for (let n: FakeNode | null = this; n && !e.propagationStopped; n = n.parentElement) {
			for (const l of n.listeners.click ?? []) l(e);
			if (n.tag === 'label' && !e.propagationStopped && !e.defaultPrevented) {
				const box = n.find((c) => c.tag === 'input');
				if (box && box !== this) { box.checked = !box.checked; box.fire('change'); }
				else if (box === this) { box.checked = !box.checked; box.fire('change'); }
			}
		}
		return e;
	}
	fire(t: string) { const e = new FakeEvent(t, this); for (const l of this.listeners[t] ?? []) l(e); }
	find(p: (n: FakeNode) => boolean): FakeNode | null {
		for (const c of this.children) { if (p(c)) return c; const r = c.find(p); if (r) return r; }
		return null;
	}
}
