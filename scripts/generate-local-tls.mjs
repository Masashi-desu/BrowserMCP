#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, parse, resolve } from "node:path";

const generatedFiles = [
  "ca-cert.pem",
  "ca-cert.srl",
  "ca-key.pem",
  "localhost-cert.pem",
  "localhost-key.pem",
  "localhost.csr",
  "localhost.ext",
];

function runOpenSsl(args) {
  const result = spawnSync("openssl", args, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    const suffix = result.error.code === "ENOENT" ? "; install OpenSSL and add it to PATH" : "";
    throw new Error(`Unable to run openssl${suffix}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `openssl ${args[0] ?? "command"} failed${result.signal ? ` with ${result.signal}` : ` with exit code ${result.status ?? "unknown"}`}`,
    );
  }
}

function validatedOutputDirectory(rawValue) {
  if (!rawValue || rawValue === "." || rawValue === "..") {
    throw new Error(`Refusing unsafe TLS output directory: ${rawValue || "<empty>"}.`);
  }
  const outputDirectory = resolve(rawValue);
  if (outputDirectory === parse(outputDirectory).root || outputDirectory === resolve(".")) {
    throw new Error(`Refusing unsafe TLS output directory: ${rawValue}.`);
  }
  const existing = lstatSync(outputDirectory, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    throw new Error(
      `Refusing to write TLS material through a symbolic-link directory: ${rawValue}.`,
    );
  }
  if (existing && !existing.isDirectory()) {
    throw new Error(`TLS output path is not a directory: ${rawValue}.`);
  }
  for (const generatedFile of generatedFiles) {
    if (lstatSync(join(outputDirectory, generatedFile), { throwIfNoEntry: false })) {
      throw new Error(`Refusing to overwrite ${join(rawValue, generatedFile)}.`);
    }
  }
  return outputDirectory;
}

function generate(outputDirectory) {
  mkdirSync(outputDirectory, { mode: 0o700, recursive: true });
  chmodSync(outputDirectory, 0o700);

  const caKey = join(outputDirectory, "ca-key.pem");
  const caCertificate = join(outputDirectory, "ca-cert.pem");
  const localhostKey = join(outputDirectory, "localhost-key.pem");
  const localhostRequest = join(outputDirectory, "localhost.csr");
  const localhostExtensions = join(outputDirectory, "localhost.ext");
  const localhostCertificate = join(outputDirectory, "localhost-cert.pem");

  runOpenSsl(["genrsa", "-out", caKey, "3072"]);
  runOpenSsl([
    "req",
    "-x509",
    "-new",
    "-sha256",
    "-key",
    caKey,
    "-days",
    "3650",
    "-subj",
    "/CN=BrowserMCP Local Development CA/O=BrowserMCP local development",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-out",
    caCertificate,
  ]);

  runOpenSsl(["genrsa", "-out", localhostKey, "2048"]);
  runOpenSsl([
    "req",
    "-new",
    "-sha256",
    "-key",
    localhostKey,
    "-subj",
    "/CN=localhost/O=BrowserMCP local bridge",
    "-out",
    localhostRequest,
  ]);
  writeFileSync(
    localhostExtensions,
    [
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  runOpenSsl([
    "x509",
    "-req",
    "-sha256",
    "-in",
    localhostRequest,
    "-CA",
    caCertificate,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-days",
    "397",
    "-extfile",
    localhostExtensions,
    "-out",
    localhostCertificate,
  ]);

  chmodSync(caKey, 0o600);
  chmodSync(localhostKey, 0o600);
  for (const transientFile of ["ca-cert.srl", "localhost.csr", "localhost.ext"]) {
    rmSync(join(outputDirectory, transientFile), { force: true });
  }
}

try {
  if (process.argv.length > 3) throw new Error("Usage: generate-local-tls.mjs [output-directory]");
  const requestedDirectory = process.argv[2] ?? ".browsermcp/tls";
  const outputDirectory = validatedOutputDirectory(requestedDirectory);
  const previousUmask = process.platform === "win32" ? undefined : process.umask(0o077);
  try {
    generate(outputDirectory);
  } finally {
    if (previousUmask !== undefined) process.umask(previousUmask);
  }
  process.stdout.write(
    [
      `Created a local CA and localhost certificate in ${requestedDirectory}.`,
      "",
      "Next steps (not performed automatically):",
      `  1. Inspect ${join(requestedDirectory, "ca-cert.pem")}.`,
      "  2. Trust only that CA for SSL in the current OS/browser trust store if appropriate.",
      "  3. Start the Bridge with its TLS certificate and key options.",
      "",
      "Keep ca-key.pem and localhost-key.pem private. This directory is ignored by git.",
      "",
    ].join("\n"),
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
