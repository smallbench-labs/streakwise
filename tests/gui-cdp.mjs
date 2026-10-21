const [,, expr, shot] = process.argv;
const list = await (await fetch('http://localhost:9333/json')).json();
const ws = new WebSocket(list.find(t => process.env.TGT ? t.title.startsWith(process.env.TGT) : t.url.startsWith('app://')).webSocketDebuggerUrl);
let id = 0; const pend = {};
ws.onmessage = e => { const m = JSON.parse(e.data); pend[m.id]?.(m); };
const call = (method, params={}) => new Promise(r => { pend[++id]=r; ws.send(JSON.stringify({id, method, params})); });
await new Promise(r => ws.onopen = r);
const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result));
if (shot) { await new Promise(r=>setTimeout(r,1200)); const s = await call('Page.captureScreenshot',{format:'png'}); (await import('fs')).writeFileSync(shot, Buffer.from(s.result.data,'base64')); }
process.exit(0);
