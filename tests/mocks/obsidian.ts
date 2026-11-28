// Minimal `obsidian` stand-in for unit tests that import UI modules (aliased in `npm test`).
// Only what settings.ts touches is implemented.
import { FakeNode } from './fakeDom';
export class FakeEl extends FakeNode {}
type Chain = Record<string, (...a: unknown[]) => unknown>;
function chain(): Chain {
	const c: Chain = new Proxy({}, { get: (_t, k) => (k === 'inputEl' ? {} : () => c) }) as Chain;
	return c;
}
export class Setting {
	static created: Setting[] = [];
	settingEl = new FakeEl();
	controlEl = new FakeEl();
	infoEl = new FakeEl();
	descEl = new FakeEl();
	name = '';
	buttons: Array<{ text: string; click?: () => unknown }> = [];
	constructor(_el?: unknown) { Setting.created.push(this); }
	setName(n: string) { this.name = n; return this; }
	setDesc() { return this; }
	setHeading() { return this; }
	addText(cb: (t: Chain) => void) { cb(chain()); return this; }
	addDropdown(cb: (d: Chain) => void) { cb(chain()); return this; }
	addButton(cb: (b: Chain) => void) {
		const rec: { text: string; click?: () => unknown } = { text: '' };
		const b: Chain = new Proxy({}, { get: (_t, k) => (...a: unknown[]) => {
			if (k === 'setButtonText') rec.text = String(a[0]);
			if (k === 'onClick') rec.click = a[0] as () => unknown;
			return b;
		} }) as Chain;
		cb(b);
		this.buttons.push(rec);
		return this;
	}
}
/** Toggle per test: true simulates Obsidian 1.13+ (declarative API present on the base class). */
export const mockEnv = { declarative: true, updates: 0, domRefreshes: 0 };
export class PluginSettingTab {
	containerEl = new FakeEl();
	constructor(public app: unknown, public plugin: unknown) {}
	hide() {}
}
const proto = PluginSettingTab.prototype as unknown as Record<string, unknown>;
export function setDeclarative(on: boolean) {
	mockEnv.declarative = on;
	if (on) {
		proto.getSettingDefinitions = function () { return []; };
		proto.update = function () { mockEnv.updates++; };
		proto.refreshDomState = function () { mockEnv.domRefreshes++; };
	} else {
		delete proto.getSettingDefinitions;
		delete proto.update;
		delete proto.refreshDomState;
	}
}
setDeclarative(true);
export const moment = () => ({ isValid: () => true, format: () => '2026-10-21' });
export const requestUrl = async () => ({ status: 200, json: null });
export class App {}
export class TFile {}
export class TFolder {}
export const Platform = { isMacOS: false, isWin: false, isLinux: true, isIosApp: false, isAndroidApp: false };
