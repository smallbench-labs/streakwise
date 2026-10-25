import { HttpGetJson, checkRegion } from './checkout';

/**
 * Region state for the "Buy Pro" row (S-34). Pure, no `obsidian` import.
 * - 'unknown' until the region check finishes: hidden.
 * - explicitly allowed: 'show'.
 * - explicitly blocked (e.g. Japan): 'hide'.
 * - request failed, timed out or unexpected answer: 'error' (hidden, fail closed, with a note).
 * The check runs at most once per settings-tab session (reset() on hide).
 */
export type BuyState = 'unknown' | 'show' | 'hide' | 'error';

export class BuyGate {
	private state: BuyState = 'unknown';
	private inflight: Promise<void> | null = null;

	constructor(private readonly get: HttpGetJson, private readonly delay?: (ms: number) => Promise<void>) {}

	get current(): BuyState {
		return this.state;
	}

	visible(): boolean {
		return this.state === 'show';
	}

	/** The region could not be checked: show the "try again later" note. */
	failed(): boolean {
		return this.state === 'error';
	}

	/** Starts the region check if not started; calls onSettled once it is known. */
	ensure(onSettled: () => void): Promise<void> {
		if (this.state !== 'unknown') return Promise.resolve();
		if (!this.inflight) {
			this.inflight = checkRegion(this.get, undefined, this.delay).then((r) => {
				this.state = r === 'allowed' ? 'show' : r === 'blocked' ? 'hide' : 'error';
				onSettled();
			});
		}
		return this.inflight;
	}

	reset(): void {
		this.state = 'unknown';
		this.inflight = null;
	}
}
