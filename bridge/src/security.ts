import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export type SecretKind = "admin" | "mcp" | "pair" | "resume" | "ui";

export function createSecret(kind: SecretKind): string {
  return `bmp_${kind}_${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export class SecretVerifier {
  readonly #digest: Buffer;

  public constructor(secret: string) {
    this.#digest = digest(secret);
  }

  public verify(candidate: string | undefined): boolean {
    if (candidate === undefined) return false;
    return timingSafeEqual(this.#digest, digest(candidate));
  }
}

export function bearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header);
  return match?.[1];
}

export function normalizeWebOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (
      url.protocol === "http:" &&
      url.hostname.toLowerCase() !== "localhost" &&
      url.hostname !== "127.0.0.1"
    ) {
      return undefined;
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

interface ExpiringToken<T> {
  readonly expiresAt: number;
  readonly value: T;
}

/** Stores only SHA-256 token digests; successful consumption is atomic and one-time. */
export class OneTimeTokenStore<T> {
  readonly #entries = new Map<string, ExpiringToken<T>>();
  readonly #kind: "pair" | "resume";
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #ttlMs: number;

  public constructor(
    kind: "pair" | "resume",
    ttlMs: number,
    now: () => number = Date.now,
    maxEntries = 256,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError("maxEntries must be a positive safe integer");
    }
    this.#kind = kind;
    this.#ttlMs = ttlMs;
    this.#now = now;
    this.#maxEntries = maxEntries;
  }

  public issue(value: T): { token: string; expiresAt: number } {
    this.sweep();
    while (this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    const token = createSecret(this.#kind);
    const expiresAt = this.#now() + this.#ttlMs;
    this.#entries.set(digest(token).toString("base64url"), { expiresAt, value });
    return { token, expiresAt };
  }

  public consume(token: string): T | undefined {
    return this.consumeIf(token, () => true);
  }

  public consumeIf(token: string, predicate: (value: T) => boolean): T | undefined {
    const key = digest(token).toString("base64url");
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    if (!predicate(entry.value)) return undefined;
    this.#entries.delete(key);
    return entry.value;
  }

  public revokeAll(predicate: (value: T) => boolean): void {
    for (const [key, entry] of this.#entries) {
      if (predicate(entry.value)) this.#entries.delete(key);
    }
  }

  public sweep(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }

  public get size(): number {
    this.sweep();
    return this.#entries.size;
  }
}

export interface UiSession {
  readonly csrfToken: string;
  readonly csrfVerifier: SecretVerifier;
  readonly expiresAt: number;
  readonly verifier: SecretVerifier;
}

export class AdminAuthenticator {
  readonly #adminVerifier: SecretVerifier;
  readonly #now: () => number;
  readonly #sessions = new Map<string, UiSession>();
  readonly #ttlMs: number;

  public constructor(adminSecret: string, ttlMs: number, now: () => number = Date.now) {
    this.#adminVerifier = new SecretVerifier(adminSecret);
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  public verifyBearer(header: string | string[] | undefined): boolean {
    return this.#adminVerifier.verify(bearerToken(header));
  }

  public createSession(): { csrfToken: string; token: string; expiresAt: number } {
    this.sweep();
    while (this.#sessions.size >= 16) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) break;
      this.#sessions.delete(oldest);
    }
    const token = createSecret("ui");
    const csrfToken = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = this.#now() + this.#ttlMs;
    this.#sessions.set(digest(token).toString("base64url"), {
      csrfToken,
      csrfVerifier: new SecretVerifier(csrfToken),
      expiresAt,
      verifier: new SecretVerifier(token),
    });
    return { csrfToken, token, expiresAt };
  }

  public verifySession(candidate: string | undefined): boolean {
    if (!candidate) return false;
    const session = this.#sessions.get(digest(candidate).toString("base64url"));
    if (session === undefined || session.expiresAt <= this.#now()) return false;
    return session.verifier.verify(candidate);
  }

  public csrfToken(candidate: string | undefined): string | undefined {
    if (!candidate) return undefined;
    const session = this.#sessions.get(digest(candidate).toString("base64url"));
    if (session === undefined || session.expiresAt <= this.#now()) return undefined;
    return session.verifier.verify(candidate) ? session.csrfToken : undefined;
  }

  public verifyCsrf(sessionToken: string | undefined, candidate: string | undefined): boolean {
    if (!sessionToken || !candidate) return false;
    const session = this.#sessions.get(digest(sessionToken).toString("base64url"));
    if (session === undefined || session.expiresAt <= this.#now()) return false;
    return session.verifier.verify(sessionToken) && session.csrfVerifier.verify(candidate);
  }

  public sweep(): void {
    const now = this.#now();
    for (const [key, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(key);
    }
  }
}

export function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  if (!header) return result;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const rawValue = pair.slice(separator + 1).trim();
    try {
      result.set(name, decodeURIComponent(rawValue));
    } catch {
      // Invalid cookie values are ignored rather than reflected in an error.
    }
  }
  return result;
}
