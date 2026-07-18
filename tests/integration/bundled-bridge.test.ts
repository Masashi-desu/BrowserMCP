import { type ChildProcessByStdio, spawn } from "node:child_process";
import { createServer } from "node:net";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const bundlePath = fileURLToPath(
  new URL("../../bridge/bundle/browsermcp-bridge.mjs", import.meta.url),
);

interface ReadyEvent {
  readonly type: "ready";
  readonly mcpEndpoint: string;
  readonly mcpToken: string;
  readonly browserEndpoint: string;
  readonly statusEndpoint: string;
  readonly adminToken: string;
  readonly pairingTokens: readonly {
    readonly expiresAt: number;
    readonly origin: string;
    readonly token: string;
  }[];
}

type BridgeChild = ChildProcessByStdio<null, Readable, Readable>;

const reservePort = async (): Promise<number> =>
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitForReady = async (child: BridgeChild): Promise<ReadyEvent> =>
  await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`Bridge ready timeout: ${stderr}`)), 10_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(stdout.slice(0, newline)) as ReadyEvent);
      } catch (error) {
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Bridge exited before ready (${code ?? signal ?? "unknown"}): ${stderr}`));
    });
  });

const waitForExit = async (child: BridgeChild): Promise<number | null> =>
  await new Promise((resolve) => child.once("exit", (code) => resolve(code)));

describe("bundled cross-platform Bridge", () => {
  let child: BridgeChild | undefined;

  afterEach(async () => {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGKILL");
    await waitForExit(child);
  });

  it("starts the single-file runtime, emits structured readiness, and serves health", async () => {
    const port = await reservePort();
    const origin = "http://127.0.0.1:4173";
    const runningChild = spawn(
      process.execPath,
      [bundlePath, "--json", "--port", String(port), "--pair-origin", origin],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    child = runningChild;

    const ready = await waitForReady(runningChild);
    expect(ready.type).toBe("ready");
    expect(ready.mcpEndpoint).toBe(`http://127.0.0.1:${port}/mcp`);
    expect(ready.browserEndpoint).toBe(`ws://127.0.0.1:${port}/browser`);
    expect(ready.statusEndpoint).toBe(`http://127.0.0.1:${port}/`);
    expect(ready.mcpToken.startsWith("bmp_mcp_")).toBe(true);
    expect(ready.adminToken.startsWith("bmp_admin_")).toBe(true);
    expect(ready.pairingTokens).toHaveLength(1);
    expect(ready.pairingTokens[0]?.origin).toBe(origin);
    expect(ready.pairingTokens[0]?.token.startsWith("bmp_pair_")).toBe(true);

    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: origin },
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    runningChild.kill(process.platform === "win32" ? "SIGBREAK" : "SIGTERM");
    const exitCode = await waitForExit(runningChild);
    if (process.platform !== "win32") expect(exitCode).toBe(0);
  });
});
