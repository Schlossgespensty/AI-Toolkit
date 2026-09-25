import { convertFileSrc } from '@tauri-apps/api/core';
import { rpc, game } from './runtime';
export const loadedSkins = async () => {
  const files: Record<string, string> = await (
    await fetch('../assets/aiv/skin-manifest.json')
  ).json();
  const result = await rpc(
    'load-skins',
  );
  const local = await game('units').catch(() => ({
    sprites: {},
  }));
  const skins: Record<string, string> = {};
  for (const [id, file] of Object.entries(files))
    skins[id] = new URL('../assets/aiv/skins/' + file, location.href).href;
  const sprites: Record<string, { path: string }> = ('sprites' in local ? local.sprites : undefined) || {};
  for (const [id, value] of Object.entries(sprites)) skins[id] = convertFileSrc(value.path);
  return { ...result, skins: { ...skins, ...result.skins } };
};

/** Idle poses retain source dimensions/anchors; only their transport URL changes. */
export async function gameUnitSprites() {
  const assets = await game('units');
  if (!('idleSprites' in assets)) return assets;
  return {
    ...assets,
    idleSprites: assets.idleSprites && Object.fromEntries(
      Object.entries(assets.idleSprites).map(([id, sprite]) => [
        id, { ...sprite, path: convertFileSrc(sprite.path) },
      ]),
    ),
  };
}
export function assetUrls(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('file:')) {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname).replace(/^\/([A-Z]:)/i, '$1');
    return convertFileSrc(url.host ? '//' + url.host + path : path);
  }
  if (Array.isArray(value)) return value.map(assetUrls);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, assetUrls(child)]));
  return value;
}
