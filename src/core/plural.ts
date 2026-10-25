/** "1 day", "2 days" (m-02). */
export function dayCount(n: number): string {
	return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** "1 more day", "2 more days". */
export function moreDays(n: number): string {
	return `${n} more ${n === 1 ? 'day' : 'days'}`;
}
