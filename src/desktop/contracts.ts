/** Both sides of the IPC contract are generated from their Rust producers. */
import type { Request } from './generated/Request';
import type { GameRequest } from './generated/GameRequest';
import type { DesktopResults } from './generated/DesktopResults';
import type { GameResults } from './generated/GameResults';
export type { NativeError } from './generated/NativeError';
export type { UpdateStatus } from './generated/UpdateStatus';
export type { AiProject } from './generated/AiProject';
export type { UnitSprite } from './generated/UnitSprite';
export type { UnitAssets } from './generated/UnitAssets';

export type AiIdentity = Pick<DesktopPayload<'create-ai'>, 'gameRoot' | 'aiId' | 'name' | 'author' | 'version'>;
export type ProjectLocation = Pick<DesktopPayload<'read-project'>, 'gameRoot' | 'aiRoot'>;
export type { MediaRequest } from './generated/MediaRequest';
export type { ReadProject } from './generated/ReadProject';
export type { CloneAi } from './generated/CloneAi';
export type { UpdateMapping } from './generated/UpdateMapping';
export type { UpdateAi } from './generated/UpdateAi';

export type DesktopOperation = Request['operation'];
export type GameOperation = GameRequest['operation'];
type Payload<R> = R extends { payload: infer P } ? P : undefined;
export type DesktopPayload<O extends DesktopOperation> = Payload<Extract<Request, { operation: O }>>;
export type GamePayload<O extends GameOperation> = Payload<Extract<GameRequest, { operation: O }>>;
export type Arguments<P> = [P] extends [undefined] ? [] : [payload: P];

// These constraints fail compilation when a Rust variant is added/removed
// without documenting its frontend result, including unused operations.
type Complete<K extends PropertyKey, T extends Record<K, unknown>> = T;
export type DesktopResponse<O extends DesktopOperation> = Complete<DesktopOperation, DesktopResults>[O];
export type GameResponse<O extends GameOperation> = Complete<GameOperation, GameResults>[O];
type NoExtraResponses = Exclude<keyof DesktopResults, DesktopOperation> | Exclude<keyof GameResults, GameOperation>;
type ExpectNever<T extends never> = T;
export type ResponseCoverage = ExpectNever<NoExtraResponses>;
