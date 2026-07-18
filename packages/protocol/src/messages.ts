import {
  type BridgeMessageOfType,
  type BridgeMessageType,
  type CreateBridgeMessageOptions,
  type MessagePayloads,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
} from "./types.js";
import { parseBridgeMessage } from "./validation.js";

function messageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function createBridgeMessage<T extends BridgeMessageType>(
  type: T,
  payload: MessagePayloads[T],
  options: CreateBridgeMessageOptions = {},
): BridgeMessageOfType<T> {
  const version = options.version ?? PROTOCOL_VERSION;
  const candidate = {
    protocol: PROTOCOL_ID,
    version,
    id: options.id ?? messageId(),
    type,
    timestamp: options.timestamp ?? Date.now(),
    ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
    payload,
  };
  return parseBridgeMessage(candidate, {
    supportedVersions: [version],
  }) as BridgeMessageOfType<T>;
}

export function serializeBridgeMessage(message: unknown): string {
  return JSON.stringify(parseBridgeMessage(message));
}
