import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const childProcesses = new Set<ChildProcess>();

afterEach(() => {
  for (const child of childProcesses) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  childProcesses.clear();
});

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No TCP test address");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

describe("Bridge CLI process lifecycle", () => {
  it("starts with one JSON ready line and stops on the platform shutdown signal", async () => {
    const port = await freeLoopbackPort();
    const entry = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
    const child = spawn(
      process.execPath,
      [entry, "--json", "--port", String(port), "--pair-origin", "https://app.test"],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    childProcesses.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const readyLine = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for ready event; stderr: ${stderr}`));
      }, 5_000);
      const inspect = () => {
        const newline = stdout.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timeout);
        child.stdout.off("data", inspect);
        resolve(stdout.slice(0, newline));
      };
      child.stdout.on("data", inspect);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        if (!stdout.includes("\n")) {
          clearTimeout(timeout);
          reject(new Error(`Bridge exited before ready (${code ?? signal}); stderr: ${stderr}`));
        }
      });
    });

    const ready = JSON.parse(readyLine) as Record<string, unknown>;
    expect(ready).toMatchObject({
      type: "ready",
      mcpEndpoint: `http://127.0.0.1:${port}/mcp`,
      browserEndpoint: `ws://127.0.0.1:${port}/browser`,
      statusEndpoint: `http://127.0.0.1:${port}/`,
    });
    expect(ready.mcpToken).toEqual(expect.any(String));
    expect(ready.adminToken).toEqual(expect.any(String));
    expect(ready.pairingTokens).toEqual([
      expect.objectContaining({ origin: "https://app.test", token: expect.any(String) }),
    ]);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);

    expect(child.kill(process.platform === "win32" ? "SIGBREAK" : "SIGTERM")).toBe(true);
    const forceTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    const result = await exit;
    childProcesses.delete(child);
    clearTimeout(forceTimeout);
    if (process.platform !== "win32") expect(result).toEqual({ code: 0, signal: null });
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(stderr).toContain("BrowserMCP Bridge started");
  });
});
