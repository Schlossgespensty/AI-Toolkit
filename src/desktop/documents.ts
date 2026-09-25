import { parseAiv, encodeAiv } from '../node/aiv-codec.mjs';
import { rpc, tr, state } from './runtime';
import type { RecordData, SaveRequest, DocumentResult } from './types';
const configs = new Map<string, Promise<RecordData>>();
export function loadConfig(file: string) {
  if (!configs.has(file)) {
    configs.set(
      file,
      rpc('load-config', { file }).catch((error) => {
        configs.delete(file);
        throw error;
      }),
    );
  }
  return configs.get(file)!;
}

/** Keep Save As inside the active AI, while retaining its proposed filename. */
export function projectDialogPath(proposed?: string) {
  if (!state.projectRoot) return proposed;
  return proposed
    ? state.projectRoot.replace(/[\\/]$/, '') + '/' + proposed.split(/[\\/]/).pop()
    : state.projectRoot;
}

export function castleSaveFilters(kind: string) {
  const classic = { name: tr('native:classic_castle'), extensions: ['aiv'] };
  const definitive = { name: tr('castle:definitive_edition_json'), extensions: ['aivjson'] };
  return kind === 'aivjson' ? [definitive, classic] : [classic, definitive];
}
export function fromBase64(data: string) {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export function decodeDocument(result: DocumentResult | null) {
  if (!result) return null;
  if (result.sourceBase64) {
    result.sourceBytes = fromBase64(result.sourceBase64);
    result.document = parseAiv(result.sourceBytes);
    delete result.sourceBase64;
  }
  return result;
}
async function sourceBytes(request: SaveRequest) {
  if (request.sourceBytes?.length) return new Uint8Array(request.sourceBytes);
  if (request.sourcePath?.toLowerCase().endsWith('.aiv')) {
    try {
      return fromBase64(await rpc('read-bytes', { path: request.sourcePath }));
    } catch {
      /* Fresh encoding remains possible. */
    }
  }
  return null;
}
export async function encodeCastle(request: SaveRequest) {
  const source = await sourceBytes(request);
  if (request.unchanged && source) return source;
  const document =
    typeof request.content === 'string' ? JSON.parse(request.content) : request.content;
  const issues = window.castleFormat.classicIssues(
    document,
    await loadConfig('aiv_constants.json'),
  );
  if (issues.length)
    throw new Error(tr('native:classic_export_failed', { issues: issues.join('\n') }));
  return new Uint8Array(encodeAiv(document, await loadConfig('aiv_templates.json'), { source }));
}
export async function save(request: SaveRequest) {
  let path = request.path;
  const castle = request.kind === 'aiv' || request.kind === 'aivjson';
  if (!path)
    path =
      (await rpc('pick-path', {
        save: true,
        defaultPath: projectDialogPath(request.defaultPath),
        filters: castle
          ? castleSaveFilters(request.kind!)
          : [{ name: 'JSON', extensions: ['json'] }],
      })) || undefined;
  if (!path) return null;
  if (castle) {
    // Native dialogs usually append the chosen filter's extension. If a
    // platform returns none, ask rather than silently exporting another format.
    if (!/\.(aiv|aivjson|aijson)$/i.test(path)) {
      const format = await rpc('confirm', {
        title: tr('native:save_as'),
        message: tr('native:choose_castle_format'),
        choices: [
          tr('native:classic_castle'),
          tr('castle:definitive_edition_json'),
          tr('common:actions.cancel'),
        ],
        values: ['aiv', 'aivjson', null],
      });
      if (!format) return null;
      path += '.' + format;
    }
    if (/\.aiv$/i.test(path)) {
      const bytes = await encodeCastle(request);
      await rpc('write-file', { path, base64: toBase64(bytes) });
      return { path, native: true, sourceBytes: bytes };
    }
    const document =
      typeof request.content === 'string' ? JSON.parse(request.content) : request.content;
    await rpc('write-file', { path, content: window.castleFormat.stringify(document) });
    return { path, native: false, sourceBytes: null };
  }
  await rpc('write-file', {
    path,
    content: typeof request.content === 'string' ? request.content : JSON.stringify(request.content, null, 2),
  });
  return path;
}
export async function open(kind = 'json') {
  const path = await rpc('pick-path', {
    defaultPath: state.projectRoot,
    filters: [
      {
        name: kind === 'aiv' ? tr('native:castle_files') : 'JSON',
        extensions: kind === 'aiv' ? ['aiv', 'aivjson', 'aijson'] : ['json'],
      },
    ],
  });
  return path
    ? decodeDocument(await rpc('read-document', { path, castle: kind === 'aiv' }))
    : null;
}
export const imageDialog = () => ({
  defaultPath: state.projectRoot,
  filters: [{ name: tr('native:images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
});
