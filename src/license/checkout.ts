/**
 * Purchase flow goes through the shared checkout gate on formchime.com.
 * Never link a Polar checkout page directly: the gate blocks Japan and
 * creates the Polar checkout server-side.
 */
export const CHECKOUT_URL = 'https://formchime.com/api/checkout?product=streakwise-pro';
export const REGION_URL = 'https://formchime.com/api/region';

export type HttpGetJson = (url: string) => Promise<{ status: number; json: unknown }>;

/** Max wait for /api/region before treating the check as failed. */
export const REGION_TIMEOUT_MS = 10_000;

export type RegionResult = 'allowed' | 'blocked' | 'error';

// Obsidian renderer: window.setTimeout. Without a window (unit tests) the timeout is injected by the caller.
const defaultDelay = (ms: number) => new Promise<void>((resolve) => { if (typeof window !== 'undefined') window.setTimeout(resolve, ms); });

/**
 * Ask the gate whether Pro can be sold here. Fail closed: a failed or timed-out request,
 * an error status, or a body that is not `{ blocked: boolean }` is 'error' (Buy Pro hidden).
 */
export async function checkRegion(
	get: HttpGetJson,
	timeoutMs: number = REGION_TIMEOUT_MS,
	delay: (ms: number) => Promise<void> = defaultDelay,
): Promise<RegionResult> {
	try {
		const res = await Promise.race([get(REGION_URL), delay(timeoutMs).then(() => null)]);
		if (!res || res.status !== 200) return 'error';
		const body = res.json;
		if (!body || typeof body !== 'object' || Array.isArray(body)) return 'error';
		const blocked = (body as { blocked?: unknown }).blocked;
		if (blocked === true) return 'blocked';
		if (blocked === false) return 'allowed';
		return 'error';
	} catch {
		return 'error';
	}
}

/** True only when the gate explicitly allows this region. */
export async function shouldShowBuyButton(get: HttpGetJson, timeoutMs?: number, delay?: (ms: number) => Promise<void>): Promise<boolean> {
	return (await checkRegion(get, timeoutMs, delay)) === 'allowed';
}
