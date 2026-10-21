import { requestUrl } from 'obsidian';
import { HttpPost } from './types';

/** Adapter: Obsidian's requestUrl (bypasses CORS, works on desktop and mobile). */
export const obsidianHttpPost: HttpPost = async (url, body) => {
	const res = await requestUrl({
		url,
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify(body),
		throw: false, // we want 4xx bodies, not exceptions
	});
	let json: unknown = null;
	try { json = res.json; } catch { json = null; }
	return { status: res.status, json };
};
