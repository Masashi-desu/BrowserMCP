#!/usr/bin/env node

import { chmod, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { rolldown } from "rolldown";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(repositoryRoot, "bridge/dist/cli.js");
const output = resolve(repositoryRoot, "bridge/bundle/browsermcp-bridge.mjs");

try {
  await stat(entry);
} catch {
  throw new Error(`Bridge entry point is missing at ${entry}; run the Bridge build first`);
}

await mkdir(dirname(output), { recursive: true });
const bundle = await rolldown({
  cwd: repositoryRoot,
  external: (id) => id.startsWith("node:"),
  input: entry,
  platform: "node",
  // The entry is compiled JavaScript. Disabling TypeScript lookup also keeps this
  // build independent from the absolute checkout location used by Xcode.
  tsconfig: false,
});

try {
  await bundle.write({
    file: output,
    format: "esm",
    sourcemap: false,
  });
} finally {
  await bundle.close();
}

await chmod(output, 0o755);
process.stdout.write(`${output}\n`);
