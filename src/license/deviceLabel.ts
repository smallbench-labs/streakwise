/**
 * S-39: Polar activation label, so the user can tell devices apart in the customer portal.
 * Only the app, the platform and the vault name: no user name, email or host name.
 * Pure, no `obsidian` import.
 */
export interface PlatformFlags {
	isMacOS?: boolean;
	isWin?: boolean;
	isLinux?: boolean;
	isIosApp?: boolean;
	isAndroidApp?: boolean;
}

export function platformName(p: PlatformFlags): string {
	if (p.isIosApp) return 'iOS';
	if (p.isAndroidApp) return 'Android';
	if (p.isMacOS) return 'macOS';
	if (p.isWin) return 'Windows';
	if (p.isLinux) return 'Linux';
	return 'Unknown platform';
}

/** "Obsidian – macOS – My vault", at most 100 characters (Polar's label limit). */
export function buildDeviceLabel(p: PlatformFlags, vaultName: string): string {
	// eslint-disable-next-line no-control-regex -- strip control characters from the vault name
	const vault = vaultName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
	const parts = ['Obsidian', platformName(p)];
	if (vault) parts.push(vault);
	return parts.join(' – ').slice(0, 100);
}
