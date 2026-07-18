import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { BrowserMcpBridge } from "../../src/bridge.js";
import { testConfig } from "./helpers.js";

describe("optional HTTPS/WSS mode", () => {
  let bridge: BrowserMcpBridge | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
    if (temporaryDirectory) rmSync(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = undefined;
  });

  it("serves trusted HTTPS health and accepts eligible WSS Origins for approval", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "browsermcp-tls-test-"));
    const certificateDirectory = join(temporaryDirectory, "tls");
    const script = fileURLToPath(
      new URL("../../../scripts/generate-local-tls.mjs", import.meta.url),
    );
    execFileSync(process.execPath, [script, certificateDirectory], { stdio: "ignore" });

    const origin = "https://public.example.test";
    bridge = new BrowserMcpBridge(
      testConfig({
        tls: {
          certPath: join(certificateDirectory, "localhost-cert.pem"),
          keyPath: join(certificateDirectory, "localhost-key.pem"),
        },
      }),
    );
    const address = await bridge.start();
    expect(address.mcpEndpoint).toMatch(/^https:\/\/127\.0\.0\.1:/);
    expect(address.browserEndpoint).toMatch(/^wss:\/\/127\.0\.0\.1:/);
    const ca = readFileSync(join(certificateDirectory, "ca-cert.pem"));

    const health = await new Promise<{ body: string; cors?: string; status: number }>(
      (resolve, reject) => {
        const request = httpsRequest(
          {
            ca,
            host: "127.0.0.1",
            port: address.port,
            path: "/health",
            headers: { Origin: origin },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            response.on("end", () =>
              resolve({
                body: Buffer.concat(chunks).toString("utf8"),
                ...(response.headers["access-control-allow-origin"]
                  ? { cors: response.headers["access-control-allow-origin"] }
                  : {}),
                status: response.statusCode ?? 0,
              }),
            );
          },
        );
        request.on("error", reject);
        request.end();
      },
    );
    expect(health).toMatchObject({ status: 200, cors: origin, body: '{"status":"ok"}' });

    const socket = new WebSocket(address.browserEndpoint, { ca, origin });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close();
    });

    const rejectedStatus = await new Promise<number>((resolve, reject) => {
      const rejected = new WebSocket(address.browserEndpoint, {
        ca,
        origin: "http://public.example.test",
      });
      rejected.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      rejected.once("open", () => {
        rejected.close();
        reject(new Error("Insecure public Origin unexpectedly opened WSS"));
      });
      rejected.once("error", () => undefined);
    });
    expect(rejectedStatus).toBe(403);
  });
});
