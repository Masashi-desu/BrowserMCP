import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/generate-local-tls.mjs", import.meta.url));
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "browsermcp-tls-generator-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runGenerator(outputDirectory: string) {
  return spawnSync(process.execPath, [script, outputDirectory], {
    encoding: "utf8",
    windowsHide: true,
  });
}

describe("cross-platform local TLS generator", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("creates the four durable PEM files with loopback SANs and refuses a rerun", () => {
    const outputDirectory = join(temporaryDirectory(), "tls output");
    const generated = runGenerator(outputDirectory);
    expect(generated.status, generated.stderr).toBe(0);

    const durableFiles = ["ca-cert.pem", "ca-key.pem", "localhost-cert.pem", "localhost-key.pem"];
    for (const name of durableFiles) {
      expect(lstatSync(join(outputDirectory, name)).isFile()).toBe(true);
    }
    const certificate = spawnSync(
      "openssl",
      [
        "x509",
        "-in",
        join(outputDirectory, "localhost-cert.pem"),
        "-noout",
        "-ext",
        "subjectAltName",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    expect(certificate.status, certificate.stderr).toBe(0);
    expect(certificate.stdout).toContain("DNS:localhost");
    expect(certificate.stdout).toContain("IP Address:127.0.0.1");

    if (process.platform !== "win32") {
      expect(lstatSync(join(outputDirectory, "ca-key.pem")).mode & 0o077).toBe(0);
      expect(lstatSync(join(outputDirectory, "localhost-key.pem")).mode & 0o077).toBe(0);
    }

    const rerun = runGenerator(outputDirectory);
    expect(rerun.status).not.toBe(0);
    expect(rerun.stderr).toContain("Refusing to overwrite");
  });

  it("refuses an existing output file before invoking OpenSSL", () => {
    const outputDirectory = join(temporaryDirectory(), "tls");
    mkdirSync(outputDirectory);
    writeFileSync(join(outputDirectory, "ca-cert.pem"), "do not replace");

    const result = runGenerator(outputDirectory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing to overwrite");
    expect(readFileSync(join(outputDirectory, "ca-cert.pem"), "utf8")).toBe("do not replace");
  });

  it("refuses symbolic-link output directories", ({ skip }) => {
    const parent = temporaryDirectory();
    const target = join(parent, "target");
    const outputDirectory = join(parent, "linked-output");
    mkdirSync(target);
    try {
      symlinkSync(target, outputDirectory, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
        return;
      }
      throw error;
    }

    const result = runGenerator(outputDirectory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("symbolic-link directory");
  });

  it("refuses a filesystem root as the output directory", () => {
    const result = runGenerator(parse(temporaryDirectory()).root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing unsafe TLS output directory");
  });
});
