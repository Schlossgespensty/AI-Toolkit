// Development diagnostics only. Never imported into a packaged editor.
import { setTimeout as delay } from 'node:timers/promises';

export class CdpDisconnectedError extends Error {}

// Closing a native window may destroy its debug transport before CDP returns
// the evaluation result. Only an independently confirmed, successful exit of
// the exact child spawned by the benchmark makes that disconnect expected.
export async function closeOwnedEditor(client, child, timeoutMs = 5000) {
  if (child.exitCode !== null) throw new Error('Owned editor already exited before close.');
  if (await client.evaluate('!!(castleEditor.isDirty()||characterEditor.isDirty()||aiContentEditor.isDirty())'))
    throw new Error('QA profile became dirty; leaving it open.');
  let disconnect;
  try {
    await client.evaluate('__TAURI__.window.getCurrentWindow().close()');
  } catch (error) {
    if (!(error instanceof CdpDisconnectedError)) throw error;
    disconnect = error.message;
  }
  const deadline = performance.now() + timeoutMs;
  while (child.exitCode === null && performance.now() < deadline) await delay(50);
  if (child.exitCode === null) throw new Error('QA editor did not close; leaving it for inspection.');
  if (child.exitCode !== 0) throw new Error(`QA editor exited with ${child.exitCode}.`);
  return { exitCode: child.exitCode, ...(disconnect ? { debugDisconnect: disconnect } : {}) };
}

export async function connectCdp(port, select = target => target.type === 'page' && target.url.includes('src/index.html')) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Supply an isolated editor debug port.');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const matches = targets.filter(select);
  if (matches.length !== 1) throw new Error(`Expected one isolated editor target, found ${matches.length}.`);
  const socket = new WebSocket(matches[0].webSocketDebuggerUrl);
  const pending = new Map();
  let serial = 0;
  const fail = error => {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(error); }
    pending.clear();
  };
  socket.onclose = () => fail(new CdpDisconnectedError('Editor debug connection closed.'));
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data), call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    message.error ? call.reject(new Error(JSON.stringify(message.error))) : call.resolve(message.result);
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Editor debug connection timed out.')); }, 5000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Editor debug connection failed.')); };
  });
  socket.onerror = () => fail(new CdpDisconnectedError('Editor debug connection failed.'));
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error('Editor debug connection is not open.')); return; }
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}
