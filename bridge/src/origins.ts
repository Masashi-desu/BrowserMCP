import { normalizeWebOrigin } from "./security.js";

/** Exact, normalized origin allow-list shared by health CORS and WebSocket upgrades. */
export class AllowedOrigins {
  readonly #origins = new Set<string>();

  public constructor(initial: readonly string[] = []) {
    for (const origin of initial) this.add(origin);
  }

  public add(value: string): string {
    const origin = normalizeWebOrigin(value);
    if (!origin) {
      throw new Error(
        "Origin must be an absolute HTTPS origin, or an HTTP localhost/127.0.0.1 development origin, without a path",
      );
    }
    this.#origins.add(origin);
    return origin;
  }

  public has(value: string | undefined): value is string {
    if (!value) return false;
    const origin = normalizeWebOrigin(value);
    return origin !== undefined && this.#origins.has(origin);
  }

  public values(): readonly string[] {
    return [...this.#origins].sort();
  }
}
