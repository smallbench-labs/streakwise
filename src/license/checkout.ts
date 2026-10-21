/**
 * Purchase flow goes through the shared checkout gate on formchime.com.
 * Never link a Polar checkout page directly: the gate blocks Japan and
 * creates the Polar checkout server-side.
 */
export const CHECKOUT_URL = 'https://formchime.com/api/checkout?product=streakwise-pro';
export const REGION_URL = 'https://formchime.com/api/region';

export type HttpGetJson = (url: string) => Promise<{ status: number; json: unknown }>;

/**
 * Decide whether to show the "Buy Pro" button.
 * Hidden only when the gate explicitly says this region is blocked.
 * Any failure (offline, error status, bad JSON) still shows the button;
 * the checkout gate and webhook enforce the block anyway.
 */
export async function shouldShowBuyButton(get: HttpGetJson): Promise<boolean> {
	try {
		const res = await get(REGION_URL);
		if (res.status !== 200) return true;
		const body = res.json as { blocked?: unknown } | null;
		return !(body && body.blocked === true);
	} catch {
		return true;
	}
}
