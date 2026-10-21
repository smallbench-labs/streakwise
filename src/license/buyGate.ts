import { HttpGetJson, shouldShowBuyButton } from './checkout';

/**
 * Region state for the "Buy Pro" row (S-34). Pure, no `obsidian` import.
 * - 'unknown' until the region check finishes: hidden.
 * - request failed or not blocked: 'show'.
 * - explicitly blocked: 'hide'.
 * The check runs at most once per settings-tab session (reset() on hide).
 */
export type BuyState = 'unknown' | 'show' | 'hide';

export class BuyGate {
	private state: BuyState = 'unknown';
	private inflight: Promise<void> | null = null;

	constructor(private readonly get: HttpGetJson) {}

	get current(): BuyState {
		return this.state;
	}

	visible(): boolean {
		return this.state === 'show';
	}

	/** Starts the region check if not started; calls onSettled once it is known. */
	ensure(onSettled: () => void): Promise<void> {
		if (this.state !== 'unknown') return Promise.resolve();
		if (!this.inflight) {
			this.inflight = shouldShowBuyButton(this.get).then((show) => {
				this.state = show ? 'show' : 'hide';
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
