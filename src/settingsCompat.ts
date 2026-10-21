/**
 * Feature detection for Obsidian 1.13's declarative settings API (getSettingDefinitions + update).
 * No `obsidian` import so it can be unit-tested. Pass PluginSettingTab.prototype.
 */
export function hasDeclarativeSettings(proto: unknown): boolean {
	const p = proto as { getSettingDefinitions?: unknown; update?: unknown } | null | undefined;
	return !!p && typeof p.getSettingDefinitions === 'function' && typeof p.update === 'function';
}
