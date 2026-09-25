// This file is typechecked, never executed. Expected failures are regressions
// if the transport ever becomes a caller-selected generic cast again.
import { rpc, game } from '../../src/desktop/runtime';
import type { AiProject, UpdateStatus } from '../../src/desktop/contracts';
import type { InterfaceSettings } from '../../src/desktop/generated/InterfaceSettings';
import type { NativeError } from '../../src/desktop/generated/NativeError';
import type { UnitSprite } from '../../src/desktop/generated/UnitSprite';

function expectType<T>(value: T): void { void value; }
expectType<Promise<string | null>>(rpc('pick-path', {}));
expectType<Promise<AiProject>>(rpc('read-project', { gameRoot: 'game', aiRoot: 'ai' }));
expectType<Promise<UpdateStatus>>(rpc('check-update', { force: true }));
expectType<Promise<string>>(rpc('set-update-source', { repo: 'owner/repo' }));
expectType<Promise<null>>(rpc('document-ready'));
expectType<InterfaceSettings>({ theme: 'ucp', language: 'fa' });
expectType<NativeError>({ code: 'nativeErrors:invalid_png' });
expectType<UpdateStatus>({ status: 'empty', repo: 'owner/repo', experimental: true });
expectType<number>({} as UnitSprite['width']);
game('units');
game('map', { path: 'map.map' });

// @ts-expect-error unknown operation
rpc('not-an-operation');
// @ts-expect-error a path is required
rpc('read-bytes');
// @ts-expect-error incorrect payload for this operation
rpc('read-bytes', { file: 'a.aiv' });
// @ts-expect-error no payload for a notification
rpc('document-ready', { path: 'a.aiv' });
// @ts-expect-error invalid payload primitive
rpc('choose-skin', { itemType: '7', dialog: {} });
// @ts-expect-error callers cannot choose an arbitrary result type
rpc<string>('load-config', { file: 'template.json' });
// @ts-expect-error scalar result cannot be treated as a record
expectType<Promise<Record<string, unknown>>>(rpc('read-bytes', { path: 'a.aiv' }));
// @ts-expect-error map needs its own path
game('map');
// @ts-expect-error map payload is not a game folder
game('tiles', { gameRoot: 'game' });
// @ts-expect-error game operations are separate from desktop operations
rpc('tiles', { path: 'map.map' });
// @ts-expect-error fixed response fields must match native serialization
expectType<InterfaceSettings>({ theme: 'ucp', locale: 'fa' });
// @ts-expect-error error results must carry the structured native error
expectType<UpdateStatus>({ status: 'error', repo: 'owner/repo' });
// @ts-expect-error absent release metadata cannot be read without narrowing status
expectType<string>(({} as UpdateStatus).installed);
// @ts-expect-error native widths are JSON numbers, never strings or bigint
expectType<UnitSprite['width']>('64');
