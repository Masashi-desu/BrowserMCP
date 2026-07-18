import {
  type BridgeMessage,
  type BridgeMessageType,
  type CapabilityRegistration,
  type InvocationOperation,
  type InvocationResult,
  type JsonObject,
  type JsonValue,
  type MessagePayloads,
  PROTOCOL_ID,
  type ProtocolContent,
  type ResourceContents,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "./types.js";

export type ProtocolValidationErrorCode =
  | "INVALID_JSON"
  | "MESSAGE_TOO_LARGE"
  | "INVALID_TYPE"
  | "MISSING_FIELD"
  | "UNKNOWN_FIELD"
  | "INVALID_VALUE"
  | "UNSUPPORTED_VERSION"
  | "LIMIT_EXCEEDED";

export class ProtocolValidationError extends Error {
  readonly code: ProtocolValidationErrorCode;
  readonly path: string;

  constructor(code: ProtocolValidationErrorCode, message: string, path = "$") {
    super(`${message} at ${path}`);
    this.name = "ProtocolValidationError";
    this.code = code;
    this.path = path;
  }
}

export interface ParseBridgeMessageOptions {
  maxBytes?: number;
  maxDepth?: number;
  maxCollectionItems?: number;
  supportedVersions?: readonly string[];
  allowUnsupportedVersion?: boolean;
}

export type SafeParseBridgeMessageResult =
  | { success: true; data: BridgeMessage }
  | { success: false; error: ProtocolValidationError };

export const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_COLLECTION_ITEMS = 10_000;
const MAX_STRING_LENGTH = 1024 * 1024;
const MAX_DESCRIPTION_LENGTH = 16_384;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CAPABILITY = /^[a-z][a-z0-9._-]{0,63}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MESSAGE_TYPES = new Set<BridgeMessageType>([
  "connect",
  "approval_required",
  "welcome",
  "register",
  "registered",
  "unregister",
  "unregistered",
  "invoke",
  "result",
  "error",
  "cancel",
  "ping",
  "pong",
  "disconnect",
]);

interface ValidationContext {
  maxDepth: number;
  maxCollectionItems: number;
}

const hasOwn = (object: object, key: string): boolean => Object.hasOwn(object, key);

function fail(code: ProtocolValidationErrorCode, message: string, path: string): never {
  throw new ProtocolValidationError(code, message, path);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("INVALID_TYPE", "Expected an object", path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_TYPE", "Expected a plain object", path);
  }
  return value as Record<string, unknown>;
}

function exactObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const object = plainObject(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (DANGEROUS_KEYS.has(key)) {
      fail("INVALID_VALUE", "Unsafe object key", `${path}.${key}`);
    }
    if (!allowed.has(key)) {
      fail("UNKNOWN_FIELD", "Unknown field", `${path}.${key}`);
    }
  }
  for (const key of required) {
    if (!hasOwn(object, key)) {
      fail("MISSING_FIELD", "Missing required field", `${path}.${key}`);
    }
  }
  return object;
}

function stringValue(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  if (typeof value !== "string") {
    fail("INVALID_TYPE", "Expected a string", path);
  }
  const min = options.min ?? 0;
  const max = options.max ?? MAX_STRING_LENGTH;
  if (value.length < min || value.length > max) {
    fail("LIMIT_EXCEEDED", `String length must be between ${min} and ${max}`, path);
  }
  if (options.pattern !== undefined && !options.pattern.test(value)) {
    fail("INVALID_VALUE", "String has an invalid format", path);
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  return stringValue(value, path, {
    min: 1,
    max: MAX_IDENTIFIER_LENGTH,
    pattern: IDENTIFIER,
  });
}

function base64Value(value: unknown, path: string): string {
  const encoded = stringValue(value, path);
  if (encoded.length === 0) return encoded;
  if (encoded.length % 4 !== 0) {
    fail("INVALID_VALUE", "Expected canonical Base64", path);
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const dataLength = encoded.length - padding;
  for (let index = 0; index < dataLength; index += 1) {
    if (!BASE64_ALPHABET.includes(encoded[index] ?? "")) {
      fail("INVALID_VALUE", "Expected canonical Base64", path);
    }
  }
  for (let index = dataLength; index < encoded.length; index += 1) {
    if (encoded[index] !== "=") fail("INVALID_VALUE", "Expected canonical Base64", path);
  }
  const finalSextet = BASE64_ALPHABET.indexOf(encoded[dataLength - 1] ?? "");
  if ((padding === 2 && (finalSextet & 15) !== 0) || (padding === 1 && (finalSextet & 3) !== 0)) {
    fail("INVALID_VALUE", "Expected canonical Base64", path);
  }
  return encoded;
}

function version(value: unknown, path: string): string {
  return stringValue(value, path, { min: 5, max: 128, pattern: SEMVER });
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail("INVALID_TYPE", "Expected a boolean", path);
  }
  return value;
}

function finiteNumber(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("INVALID_TYPE", "Expected a finite number", path);
  }
  if (options.integer === true && !Number.isInteger(value)) {
    fail("INVALID_VALUE", "Expected an integer", path);
  }
  if (options.min !== undefined && value < options.min) {
    fail("INVALID_VALUE", `Number must be at least ${options.min}`, path);
  }
  if (options.max !== undefined && value > options.max) {
    fail("INVALID_VALUE", `Number must be at most ${options.max}`, path);
  }
  return value;
}

function arrayValue(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimum = 0,
): unknown[] {
  if (!Array.isArray(value)) {
    fail("INVALID_TYPE", "Expected an array", path);
  }
  if (value.length < minimum || value.length > context.maxCollectionItems) {
    fail(
      "LIMIT_EXCEEDED",
      `Array length must be between ${minimum} and ${context.maxCollectionItems}`,
      path,
    );
  }
  return value;
}

function validateJsonValue(
  value: unknown,
  path: string,
  context: ValidationContext,
  depth = 0,
): asserts value is JsonValue {
  if (depth > context.maxDepth) {
    fail("LIMIT_EXCEEDED", "JSON nesting depth exceeded", path);
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      fail("LIMIT_EXCEEDED", "String is too long", path);
    }
    return;
  }
  if (typeof value === "number") {
    finiteNumber(value, path);
    return;
  }
  if (Array.isArray(value)) {
    arrayValue(value, path, context);
    value.forEach((entry, index) => {
      validateJsonValue(entry, `${path}[${index}]`, context, depth + 1);
    });
    return;
  }
  const object = plainObject(value, path);
  const entries = Object.entries(object);
  if (entries.length > context.maxCollectionItems) {
    fail("LIMIT_EXCEEDED", "Object has too many fields", path);
  }
  for (const [key, entry] of entries) {
    if (DANGEROUS_KEYS.has(key)) {
      fail("INVALID_VALUE", "Unsafe object key", `${path}.${key}`);
    }
    validateJsonValue(entry, `${path}.${key}`, context, depth + 1);
  }
}

function jsonObject(
  value: unknown,
  path: string,
  context: ValidationContext,
): asserts value is JsonObject {
  plainObject(value, path);
  validateJsonValue(value, path, context);
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
  path: string,
  options?: { min?: number; max?: number; pattern?: RegExp },
): void {
  if (hasOwn(object, key)) {
    stringValue(object[key], `${path}.${key}`, options);
  }
}

function optionalJson(
  object: Record<string, unknown>,
  key: string,
  path: string,
  context: ValidationContext,
): void {
  if (hasOwn(object, key)) {
    validateJsonValue(object[key], `${path}.${key}`, context);
  }
}

function origin(value: unknown, path: string): void {
  const text = stringValue(value, path, { min: 1, max: 2048 });
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    fail("INVALID_VALUE", "Expected an absolute origin URL", path);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin !== text ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    fail("INVALID_VALUE", "Expected an http(s) origin without path or credentials", path);
  }
}

function uri(value: unknown, path: string): void {
  const text = stringValue(value, path, { min: 1, max: 8192 });
  try {
    new URL(text);
  } catch {
    fail("INVALID_VALUE", "Expected an absolute URI", path);
  }
}

function validateCapabilities(value: unknown, path: string, context: ValidationContext): void {
  const capabilities = arrayValue(value, path, context);
  const seen = new Set<string>();
  capabilities.forEach((entry, index) => {
    const capability = stringValue(entry, `${path}[${index}]`, {
      min: 1,
      max: 64,
      pattern: CAPABILITY,
    });
    if (seen.has(capability)) {
      fail("INVALID_VALUE", "Duplicate capability", `${path}[${index}]`);
    }
    seen.add(capability);
  });
}

function validateAppIdentity(value: unknown, path: string): void {
  const app = exactObject(value, path, ["id", "name", "version"]);
  identifier(app.id, `${path}.id`);
  stringValue(app.name, `${path}.name`, { min: 1, max: 256 });
  version(app.version, `${path}.version`);
}

function validateRuntimeIdentity(value: unknown, path: string): void {
  const runtime = exactObject(
    value,
    path,
    ["id", "instanceId"],
    ["userAgent", "platform", "language"],
  );
  identifier(runtime.id, `${path}.id`);
  identifier(runtime.instanceId, `${path}.instanceId`);
  optionalString(runtime, "userAgent", path, { max: 4096 });
  optionalString(runtime, "platform", path, { max: 256 });
  optionalString(runtime, "language", path, { max: 128 });
}

function validateSessionInfo(value: unknown, path: string): void {
  const session = exactObject(value, path, ["id", "resumeToken", "expiresAt"]);
  identifier(session.id, `${path}.id`);
  stringValue(session.resumeToken, `${path}.resumeToken`, {
    min: 16,
    max: 4096,
  });
  finiteNumber(session.expiresAt, `${path}.expiresAt`, { min: 0, integer: true });
}

function validateRegistration(
  value: unknown,
  path: string,
  context: ValidationContext,
): asserts value is CapabilityRegistration {
  const discriminator = plainObject(value, path).kind;
  if (discriminator === "tool") {
    const tool = exactObject(
      value,
      path,
      ["kind", "id", "name", "inputSchema"],
      ["description", "outputSchema", "annotations"],
    );
    identifier(tool.id, `${path}.id`);
    identifier(tool.name, `${path}.name`);
    optionalString(tool, "description", path, { max: MAX_DESCRIPTION_LENGTH });
    jsonObject(tool.inputSchema, `${path}.inputSchema`, context);
    if (hasOwn(tool, "outputSchema")) {
      jsonObject(tool.outputSchema, `${path}.outputSchema`, context);
    }
    if (hasOwn(tool, "annotations")) {
      jsonObject(tool.annotations, `${path}.annotations`, context);
    }
    return;
  }
  if (discriminator === "resource") {
    const resource = exactObject(
      value,
      path,
      ["kind", "id", "name", "uri"],
      ["description", "mimeType", "annotations"],
    );
    identifier(resource.id, `${path}.id`);
    identifier(resource.name, `${path}.name`);
    uri(resource.uri, `${path}.uri`);
    optionalString(resource, "description", path, {
      max: MAX_DESCRIPTION_LENGTH,
    });
    optionalString(resource, "mimeType", path, { min: 1, max: 256 });
    if (hasOwn(resource, "annotations")) {
      jsonObject(resource.annotations, `${path}.annotations`, context);
    }
    return;
  }
  if (discriminator === "prompt") {
    const prompt = exactObject(
      value,
      path,
      ["kind", "id", "name"],
      ["description", "arguments", "annotations"],
    );
    identifier(prompt.id, `${path}.id`);
    identifier(prompt.name, `${path}.name`);
    optionalString(prompt, "description", path, {
      max: MAX_DESCRIPTION_LENGTH,
    });
    if (hasOwn(prompt, "arguments")) {
      const argumentsList = arrayValue(prompt.arguments, `${path}.arguments`, context);
      const names = new Set<string>();
      argumentsList.forEach((entry, index) => {
        const argumentPath = `${path}.arguments[${index}]`;
        const argument = exactObject(entry, argumentPath, ["name"], ["description", "required"]);
        const name = identifier(argument.name, `${argumentPath}.name`);
        if (names.has(name)) {
          fail("INVALID_VALUE", "Duplicate prompt argument", `${argumentPath}.name`);
        }
        names.add(name);
        optionalString(argument, "description", argumentPath, {
          max: MAX_DESCRIPTION_LENGTH,
        });
        if (hasOwn(argument, "required")) {
          booleanValue(argument.required, `${argumentPath}.required`);
        }
      });
    }
    if (hasOwn(prompt, "annotations")) {
      jsonObject(prompt.annotations, `${path}.annotations`, context);
    }
    return;
  }
  fail("INVALID_VALUE", "Unknown registration kind", `${path}.kind`);
}

function validateOperation(
  value: unknown,
  path: string,
  context: ValidationContext,
): asserts value is InvocationOperation {
  const discriminator = plainObject(value, path).kind;
  if (discriminator === "tool.call") {
    const operation = exactObject(value, path, ["kind", "arguments"]);
    jsonObject(operation.arguments, `${path}.arguments`, context);
    return;
  }
  if (discriminator === "resource.read") {
    const operation = exactObject(value, path, ["kind", "uri"]);
    uri(operation.uri, `${path}.uri`);
    return;
  }
  if (discriminator === "prompt.get") {
    const operation = exactObject(value, path, ["kind"], ["arguments"]);
    if (hasOwn(operation, "arguments")) {
      const argumentsObject = plainObject(operation.arguments, `${path}.arguments`);
      if (Object.keys(argumentsObject).length > context.maxCollectionItems) {
        fail("LIMIT_EXCEEDED", "Too many prompt arguments", `${path}.arguments`);
      }
      for (const [name, entry] of Object.entries(argumentsObject)) {
        if (DANGEROUS_KEYS.has(name)) {
          fail("INVALID_VALUE", "Unsafe object key", `${path}.arguments.${name}`);
        }
        stringValue(entry, `${path}.arguments.${name}`, { max: MAX_STRING_LENGTH });
      }
    }
    return;
  }
  fail("INVALID_VALUE", "Unknown invocation operation", `${path}.kind`);
}

function validateResourceContents(value: unknown, path: string): asserts value is ResourceContents {
  const object = plainObject(value, path);
  const hasText = hasOwn(object, "text");
  const hasBlob = hasOwn(object, "blob");
  if (hasText === hasBlob) {
    fail("INVALID_VALUE", "Resource contents require exactly one of text or blob", path);
  }
  const contents = exactObject(value, path, ["uri", hasText ? "text" : "blob"], ["mimeType"]);
  uri(contents.uri, `${path}.uri`);
  optionalString(contents, "mimeType", path, { min: 1, max: 256 });
  if (hasText) {
    stringValue(contents.text, `${path}.text`);
  } else {
    base64Value(contents.blob, `${path}.blob`);
  }
}

function validateContent(value: unknown, path: string): asserts value is ProtocolContent {
  const discriminator = plainObject(value, path).type;
  if (discriminator === "text") {
    const content = exactObject(value, path, ["type", "text"]);
    stringValue(content.text, `${path}.text`);
    return;
  }
  if (discriminator === "image" || discriminator === "audio") {
    const content = exactObject(value, path, ["type", "data", "mimeType"]);
    base64Value(content.data, `${path}.data`);
    stringValue(content.mimeType, `${path}.mimeType`, { min: 1, max: 256 });
    return;
  }
  if (discriminator === "resource_link") {
    const content = exactObject(value, path, ["type", "uri", "name"], ["description", "mimeType"]);
    uri(content.uri, `${path}.uri`);
    stringValue(content.name, `${path}.name`, { min: 1, max: 256 });
    optionalString(content, "description", path, {
      max: MAX_DESCRIPTION_LENGTH,
    });
    optionalString(content, "mimeType", path, { min: 1, max: 256 });
    return;
  }
  if (discriminator === "resource") {
    const content = exactObject(value, path, ["type", "resource"]);
    validateResourceContents(content.resource, `${path}.resource`);
    return;
  }
  fail("INVALID_VALUE", "Unknown content type", `${path}.type`);
}

function validateResult(
  value: unknown,
  path: string,
  context: ValidationContext,
): asserts value is InvocationResult {
  const discriminator = plainObject(value, path).kind;
  if (discriminator === "tool") {
    const result = exactObject(value, path, ["kind", "content"], ["structuredContent", "isError"]);
    arrayValue(result.content, `${path}.content`, context).forEach((entry, index) => {
      validateContent(entry, `${path}.content[${index}]`);
    });
    if (hasOwn(result, "structuredContent")) {
      jsonObject(result.structuredContent, `${path}.structuredContent`, context);
    }
    if (hasOwn(result, "isError")) {
      booleanValue(result.isError, `${path}.isError`);
    }
    return;
  }
  if (discriminator === "resource") {
    const result = exactObject(value, path, ["kind", "contents"]);
    arrayValue(result.contents, `${path}.contents`, context).forEach((entry, index) => {
      validateResourceContents(entry, `${path}.contents[${index}]`);
    });
    return;
  }
  if (discriminator === "prompt") {
    const result = exactObject(value, path, ["kind", "messages"], ["description"]);
    optionalString(result, "description", path, {
      max: MAX_DESCRIPTION_LENGTH,
    });
    arrayValue(result.messages, `${path}.messages`, context).forEach((entry, index) => {
      const messagePath = `${path}.messages[${index}]`;
      const message = exactObject(entry, messagePath, ["role", "content"]);
      if (message.role !== "user" && message.role !== "assistant") {
        fail("INVALID_VALUE", "Unknown prompt message role", `${messagePath}.role`);
      }
      validateContent(message.content, `${messagePath}.content`);
    });
    return;
  }
  fail("INVALID_VALUE", "Unknown invocation result kind", `${path}.kind`);
}

function validatePayload<T extends BridgeMessageType>(
  type: T,
  value: unknown,
  context: ValidationContext,
): asserts value is MessagePayloads[T] {
  const path = "$.payload";
  switch (type) {
    case "connect": {
      const payload = exactObject(value, path, [
        "supportedVersions",
        "capabilities",
        "auth",
        "app",
        "origin",
        "runtime",
      ]);
      const versions = arrayValue(
        payload.supportedVersions,
        `${path}.supportedVersions`,
        context,
        1,
      );
      const seenVersions = new Set<string>();
      versions.forEach((entry, index) => {
        const parsedVersion = version(entry, `${path}.supportedVersions[${index}]`);
        if (seenVersions.has(parsedVersion)) {
          fail(
            "INVALID_VALUE",
            "Duplicate protocol version",
            `${path}.supportedVersions[${index}]`,
          );
        }
        seenVersions.add(parsedVersion);
      });
      validateCapabilities(payload.capabilities, `${path}.capabilities`, context);
      const authValue = plainObject(payload.auth, `${path}.auth`);
      if (authValue.kind === "approval") {
        exactObject(payload.auth, `${path}.auth`, ["kind"]);
      } else if (authValue.kind === "pairing") {
        const auth = exactObject(payload.auth, `${path}.auth`, ["kind", "token"]);
        stringValue(auth.token, `${path}.auth.token`, { min: 16, max: 4096 });
      } else if (authValue.kind === "resume") {
        const auth = exactObject(payload.auth, `${path}.auth`, ["kind", "sessionId", "token"]);
        identifier(auth.sessionId, `${path}.auth.sessionId`);
        stringValue(auth.token, `${path}.auth.token`, { min: 16, max: 4096 });
      } else {
        fail("INVALID_VALUE", "Unknown authentication kind", `${path}.auth.kind`);
      }
      validateAppIdentity(payload.app, `${path}.app`);
      origin(payload.origin, `${path}.origin`);
      validateRuntimeIdentity(payload.runtime, `${path}.runtime`);
      return;
    }
    case "approval_required": {
      const payload = exactObject(value, path, ["requestId", "origin", "expiresAt"]);
      identifier(payload.requestId, `${path}.requestId`);
      origin(payload.origin, `${path}.origin`);
      finiteNumber(payload.expiresAt, `${path}.expiresAt`, {
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
        integer: true,
      });
      return;
    }
    case "welcome": {
      const payload = exactObject(value, path, [
        "selectedVersion",
        "capabilities",
        "session",
        "limits",
        "heartbeatIntervalMs",
      ]);
      version(payload.selectedVersion, `${path}.selectedVersion`);
      validateCapabilities(payload.capabilities, `${path}.capabilities`, context);
      validateSessionInfo(payload.session, `${path}.session`);
      const limits = exactObject(payload.limits, `${path}.limits`, [
        "maxMessageBytes",
        "maxConcurrentInvocations",
        "requestTimeoutMs",
      ]);
      finiteNumber(limits.maxMessageBytes, `${path}.limits.maxMessageBytes`, {
        min: 1024,
        max: DEFAULT_MAX_MESSAGE_BYTES,
        integer: true,
      });
      finiteNumber(limits.maxConcurrentInvocations, `${path}.limits.maxConcurrentInvocations`, {
        min: 1,
        max: 10_000,
        integer: true,
      });
      finiteNumber(limits.requestTimeoutMs, `${path}.limits.requestTimeoutMs`, {
        min: 1,
        max: MAX_TIMEOUT_MS,
        integer: true,
      });
      finiteNumber(payload.heartbeatIntervalMs, `${path}.heartbeatIntervalMs`, {
        min: 1_000,
        max: MAX_TIMEOUT_MS,
        integer: true,
      });
      return;
    }
    case "register": {
      const payload = exactObject(value, path, ["sessionId", "registration"]);
      identifier(payload.sessionId, `${path}.sessionId`);
      validateRegistration(payload.registration, `${path}.registration`, context);
      return;
    }
    case "registered":
    case "unregister":
    case "unregistered": {
      const payload = exactObject(value, path, ["sessionId", "registrationId"]);
      identifier(payload.sessionId, `${path}.sessionId`);
      identifier(payload.registrationId, `${path}.registrationId`);
      return;
    }
    case "invoke": {
      const payload = exactObject(value, path, [
        "sessionId",
        "invocationId",
        "registrationId",
        "operation",
        "timeoutMs",
      ]);
      identifier(payload.sessionId, `${path}.sessionId`);
      identifier(payload.invocationId, `${path}.invocationId`);
      identifier(payload.registrationId, `${path}.registrationId`);
      validateOperation(payload.operation, `${path}.operation`, context);
      finiteNumber(payload.timeoutMs, `${path}.timeoutMs`, {
        min: 1,
        max: MAX_TIMEOUT_MS,
        integer: true,
      });
      return;
    }
    case "result": {
      const payload = exactObject(
        value,
        path,
        ["sessionId", "invocationId", "output"],
        ["durationMs"],
      );
      identifier(payload.sessionId, `${path}.sessionId`);
      identifier(payload.invocationId, `${path}.invocationId`);
      validateResult(payload.output, `${path}.output`, context);
      if (hasOwn(payload, "durationMs")) {
        finiteNumber(payload.durationMs, `${path}.durationMs`, {
          min: 0,
          max: MAX_TIMEOUT_MS,
        });
      }
      return;
    }
    case "error": {
      const payload = exactObject(
        value,
        path,
        ["code", "message", "retryable"],
        ["sessionId", "invocationId", "details"],
      );
      optionalString(payload, "sessionId", path, {
        min: 1,
        max: MAX_IDENTIFIER_LENGTH,
        pattern: IDENTIFIER,
      });
      optionalString(payload, "invocationId", path, {
        min: 1,
        max: MAX_IDENTIFIER_LENGTH,
        pattern: IDENTIFIER,
      });
      stringValue(payload.code, `${path}.code`, {
        min: 1,
        max: 64,
        pattern: ERROR_CODE,
      });
      stringValue(payload.message, `${path}.message`, {
        min: 1,
        max: MAX_DESCRIPTION_LENGTH,
      });
      booleanValue(payload.retryable, `${path}.retryable`);
      optionalJson(payload, "details", path, context);
      return;
    }
    case "cancel": {
      const payload = exactObject(value, path, ["sessionId", "invocationId"], ["reason"]);
      identifier(payload.sessionId, `${path}.sessionId`);
      identifier(payload.invocationId, `${path}.invocationId`);
      optionalString(payload, "reason", path, { max: 1024 });
      return;
    }
    case "ping":
    case "pong": {
      const payload = exactObject(value, path, ["nonce"], ["sessionId"]);
      optionalString(payload, "sessionId", path, {
        min: 1,
        max: MAX_IDENTIFIER_LENGTH,
        pattern: IDENTIFIER,
      });
      identifier(payload.nonce, `${path}.nonce`);
      return;
    }
    case "disconnect": {
      const payload = exactObject(value, path, ["code", "canResume"], ["sessionId", "reason"]);
      optionalString(payload, "sessionId", path, {
        min: 1,
        max: MAX_IDENTIFIER_LENGTH,
        pattern: IDENTIFIER,
      });
      stringValue(payload.code, `${path}.code`, {
        min: 1,
        max: 64,
        pattern: ERROR_CODE,
      });
      optionalString(payload, "reason", path, { max: MAX_DESCRIPTION_LENGTH });
      booleanValue(payload.canResume, `${path}.canResume`);
      return;
    }
  }
}

function normalizeInput(input: string | unknown, maxBytes: number): unknown {
  if (typeof input === "string") {
    if (byteLength(input) > maxBytes) {
      fail("MESSAGE_TOO_LARGE", `Message exceeds ${maxBytes} bytes`, "$");
    }
    try {
      return JSON.parse(input) as unknown;
    } catch {
      fail("INVALID_JSON", "Message is not valid JSON", "$");
    }
  }

  let encoded: string;
  try {
    encoded = JSON.stringify(input) as string;
  } catch {
    fail("INVALID_JSON", "Message cannot be represented as JSON", "$");
  }
  if (typeof encoded !== "string") {
    fail("INVALID_JSON", "Message cannot be represented as JSON", "$");
  }
  if (byteLength(encoded) > maxBytes) {
    fail("MESSAGE_TOO_LARGE", `Message exceeds ${maxBytes} bytes`, "$");
  }
  return input;
}

export function parseBridgeMessage(
  input: string | unknown,
  options: ParseBridgeMessageOptions = {},
): BridgeMessage {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const context: ValidationContext = {
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxCollectionItems: options.maxCollectionItems ?? DEFAULT_MAX_COLLECTION_ITEMS,
  };
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(context.maxDepth) || context.maxDepth < 1) {
    throw new TypeError("maxDepth must be a positive safe integer");
  }
  if (!Number.isSafeInteger(context.maxCollectionItems) || context.maxCollectionItems < 1) {
    throw new TypeError("maxCollectionItems must be a positive safe integer");
  }

  const normalized = normalizeInput(input, maxBytes);
  const message = exactObject(
    normalized,
    "$",
    ["protocol", "version", "id", "type", "timestamp", "payload"],
    ["replyTo"],
  );
  if (message.protocol !== PROTOCOL_ID) {
    fail("INVALID_VALUE", "Unknown protocol identifier", "$.protocol");
  }
  const messageVersion = version(message.version, "$.version");
  const supportedVersions = options.supportedVersions ?? SUPPORTED_PROTOCOL_VERSIONS;
  if (
    options.allowUnsupportedVersion !== true &&
    !supportedVersions.includes(messageVersion as never)
  ) {
    fail("UNSUPPORTED_VERSION", "Unsupported protocol version", "$.version");
  }
  identifier(message.id, "$.id");
  if (typeof message.type !== "string" || !MESSAGE_TYPES.has(message.type as BridgeMessageType)) {
    fail("INVALID_VALUE", "Unknown message type", "$.type");
  }
  finiteNumber(message.timestamp, "$.timestamp", { min: 0, integer: true });
  optionalString(message, "replyTo", "$", {
    min: 1,
    max: MAX_IDENTIFIER_LENGTH,
    pattern: IDENTIFIER,
  });
  validatePayload(message.type as BridgeMessageType, message.payload, context);
  return normalized as BridgeMessage;
}

export function safeParseBridgeMessage(
  input: string | unknown,
  options: ParseBridgeMessageOptions = {},
): SafeParseBridgeMessageResult {
  try {
    return { success: true, data: parseBridgeMessage(input, options) };
  } catch (error) {
    if (error instanceof ProtocolValidationError) {
      return { success: false, error };
    }
    throw error;
  }
}
