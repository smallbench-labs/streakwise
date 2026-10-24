/** "1 day", "2 days" (m-02). */
export function dayCount(n: number): string {
	return `${n} ${n === 1 ? 'day' : 'days'}`;
}
