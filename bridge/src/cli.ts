#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { type BridgeAddress, BrowserMcpBridge } from "./bridge.js";
import { type BridgeConfig, configFromEnvironment } from "./config.js";

interface CliOptions {
  readonly allowedOrigins: string[];
  readonly json: boolean;
  readonly pairingOrigins: string[];
  readonly port?: number;
  readonly tlsCert?: string;
  readonly tlsKey?: string;
}

function usage(): string {
  return `BrowserMCP Bridge

Usage: browsermcp-bridge [options]

Options:
  --port <number>          Loopback port (default: 8789)
  --allow-origin <origin>  Allow an exact browser Origin; repeatable
  --pair-origin <origin>   Issue and print a one-time pairing token at startup
  --tls-cert <path>        PEM certificate for HTTPS/WSS (requires --tls-key)
  --tls-key <path>         PEM private key for HTTPS/WSS (requires --tls-cert)
  --json                   Print one machine-readable ready event to stdout
  --help                   Show this help

Environment:
  BROWSERMCP_PORT
  BROWSERMCP_ALLOWED_ORIGINS  Comma-separated exact origins
  BROWSERMCP_TLS_CERT / BROWSERMCP_TLS_KEY
  BROWSERMCP_REQUEST_TIMEOUT_MS
  BROWSERMCP_HTTP_HEADERS_TIMEOUT_MS
  BROWSERMCP_HTTP_KEEP_ALIVE_TIMEOUT_MS
  BROWSERMCP_HTTP_REQUEST_TIMEOUT_MS
  BROWSERMCP_MAX_CONCURRENT_REQUESTS
  BROWSERMCP_MAX_CONCURRENT_PER_RUNTIME
  BROWSERMCP_MAX_HTTP_BODY_BYTES
  BROWSERMCP_MAX_HTTP_CONNECTIONS
  BROWSERMCP_MAX_MCP_SUBSCRIPTIONS
  BROWSERMCP_MAX_REGISTRATIONS_PER_RUNTIME
  BROWSERMCP_MAX_REGISTRATIONS_TOTAL
  BROWSERMCP_MAX_REGISTRATION_BYTES_PER_RUNTIME
  BROWSERMCP_MAX_REGISTRATION_BYTES_TOTAL
  BROWSERMCP_MAX_WS_PAYLOAD_BYTES`;
}

function valueAfter(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseCli(args: readonly string[]): CliOptions {
  const options: {
    allowedOrigins: string[];
    json: boolean;
    pairingOrigins: string[];
    port?: number;
    tlsCert?: string;
    tlsKey?: string;
  } = { allowedOrigins: [], json: false, pairingOrigins: [] };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (flag === "--json") {
      options.json = true;
    } else if (flag === "--allow-origin") {
      options.allowedOrigins.push(valueAfter(args, index, flag));
      index += 1;
    } else if (flag === "--pair-origin") {
      options.pairingOrigins.push(valueAfter(args, index, flag));
      index += 1;
    } else if (flag === "--port") {
      const port = Number(valueAfter(args, index, flag));
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new Error("--port must be an integer from 1 to 65535");
      }
      options.port = port;
      index += 1;
    } else if (flag === "--tls-cert") {
      options.tlsCert = valueAfter(args, index, flag);
      index += 1;
    } else if (flag === "--tls-key") {
      options.tlsKey = valueAfter(args, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown option '${flag ?? ""}'`);
    }
  }
  if ((options.tlsCert === undefined) !== (options.tlsKey === undefined)) {
    throw new Error("--tls-cert and --tls-key must be provided together");
  }
  return options;
}

interface PairingGrant {
  readonly expiresAt: number;
  readonly origin: string;
  readonly token: string;
}

export interface ReadyEvent {
  readonly type: "ready";
  readonly mcpEndpoint: string;
  readonly mcpToken: string;
  readonly browserEndpoint: string;
  readonly statusEndpoint: string;
  readonly adminToken: string;
  readonly pairingTokens: readonly PairingGrant[];
}

export function formatReadyOutput(
  address: BridgeAddress,
  pairingTokens: readonly PairingGrant[],
  json: boolean,
): string {
  if (json) {
    const event: ReadyEvent = {
      type: "ready",
      mcpEndpoint: address.mcpEndpoint,
      mcpToken: address.mcpToken,
      browserEndpoint: address.browserEndpoint,
      statusEndpoint: address.statusEndpoint,
      adminToken: address.adminToken,
      pairingTokens,
    };
    return `${JSON.stringify(event)}\n`;
  }

  const lines = [
    "BrowserMCP Bridge is ready.",
    `MCP endpoint: ${address.mcpEndpoint}`,
    `MCP bearer token (shown once): ${address.mcpToken}`,
    `Browser endpoint: ${address.browserEndpoint}`,
    `Status UI: ${address.statusEndpoint}`,
    `Admin token (shown once): ${address.adminToken}`,
    ...pairingTokens.map(
      (grant) =>
        `Pairing token for ${grant.origin} (shown once, expires ${new Date(grant.expiresAt).toISOString()}): ${grant.token}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function shutdownSignalsForPlatform(
  platform: NodeJS.Platform = process.platform,
): readonly NodeJS.Signals[] {
  return platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"];
}

function mergeConfig(base: BridgeConfig, options: CliOptions): BridgeConfig {
  return {
    ...base,
    // Pairing origins are part of the allow-list as well. Including them in the
    // constructor input validates every requested Origin before the server binds.
    allowedOrigins: [
      ...new Set([...base.allowedOrigins, ...options.allowedOrigins, ...options.pairingOrigins]),
    ],
    ...(options.port ? { port: options.port } : {}),
    ...(options.tlsCert && options.tlsKey
      ? { tls: { certPath: options.tlsCert, keyPath: options.tlsKey } }
      : {}),
  };
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCli(args);
  const bridge = new BrowserMcpBridge(mergeConfig(configFromEnvironment(), options), (entry) => {
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  });
  const address = await bridge.start();
  const pairingGrants = options.pairingOrigins.map((origin) => bridge.issuePairingToken(origin));
  process.stdout.write(formatReadyOutput(address, pairingGrants, options.json));

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await bridge.close();
  };
  const stopFromSignal = () => {
    void stop().catch((error: unknown) => {
      process.stderr.write(
        `BrowserMCP Bridge failed to stop: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
  };
  for (const signal of shutdownSignalsForPlatform()) process.once(signal, stopFromSignal);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `BrowserMCP Bridge failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
