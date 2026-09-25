/** Shared desktop transport and window-local state; no editor document state. */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Listener, RecordData } from './types';
import type { Arguments, NativeError, DesktopOperation, DesktopPayload, DesktopResponse, GameOperation, GamePayload, GameResponse } from './contracts';

export const state = {
  workspace: 'ucp',
  projectRoot: null as string | null,
  shortcutCapture: false,
  overview: {} as RecordData,
  castleBindings: {} as Record<string, string[]>,
};

export function tr(key: string, args?: RecordData) {
  return window.toolkitI18n.t(key, args);
}

export function reportError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const details = error as NativeError;
    const args = details.arguments;
    const interpolation = args && typeof args === 'object' && !Array.isArray(args) ? args : undefined;
    throw new Error(
      tr(details.code, interpolation) + (details.details ? '\n' + details.details : ''),
    );
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export function rpc<O extends DesktopOperation>(operation: O, ...args: Arguments<DesktopPayload<O>>): Promise<DesktopResponse<O>> {
  const request = args.length ? { operation, payload: args[0] } : { operation };
  return invoke<DesktopResponse<O>>('desktop_request', { request }).catch(reportError);
}

export function game<O extends GameOperation>(operation: O, ...args: Arguments<GamePayload<O>>): Promise<GameResponse<O>> {
  const request = args.length ? { operation, payload: args[0] } : { operation };
  return invoke<GameResponse<O>>('game_request', { request }).catch(reportError);
}

const callbacks = new Map<string, Set<Listener>>();

export function dispatch(channel: string, data?: unknown) {
  callbacks.get(channel)?.forEach((callback) => callback(data));
}

export function on(channel: string, callback: Listener) {
  if (!callbacks.has(channel)) {
    callbacks.set(channel, new Set());
    // Global listeners also receive explicitly targeted Tauri events. Scope the
    // listener as well as the native emitter; broadcasts still reach all windows.
    void getCurrentWebviewWindow().listen(channel, (event) => dispatch(channel, event.payload)).then(() => {
      if (channel === 'load-file') void rpc('document-ready');
      if (channel === 'request-window-close') void rpc('protect-close');
    });
  }
  // The legacy preload has one document consumer, even if it is re-registered.
  if (channel === 'load-file') callbacks.get(channel)!.clear();
  callbacks.get(channel)!.add(callback);
  return () => callbacks.get(channel)?.delete(callback);
}
