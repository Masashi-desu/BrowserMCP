import { type ProtocolCapability, SUPPORTED_PROTOCOL_VERSIONS } from "./types.js";

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  original: string;
  prerelease?: readonly string[];
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function parseVersion(version: string): ParsedVersion | undefined {
  const match = SEMVER.exec(version);
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  const prerelease = match[4]?.split(".");
  return {
    major,
    minor,
    patch,
    original: version,
    ...(prerelease === undefined ? {} : { prerelease }),
  };
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) {
    return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrerelease(left?: readonly string[], right?: readonly string[]): number {
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1;
    }
    const comparison = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch ||
    comparePrerelease(left.prerelease, right.prerelease)
  );
}

/**
 * Selects the highest version listed verbatim by both peers. BrowserMCP does not
 * infer compatibility from a matching major version; every accepted wire shape
 * must be explicitly advertised by both sides.
 */
export function negotiateProtocolVersion(
  remoteVersions: readonly string[],
  localVersions: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS,
): string | undefined {
  const local = new Set(localVersions);
  return remoteVersions
    .filter((candidate) => local.has(candidate))
    .map(parseVersion)
    .filter((candidate): candidate is ParsedVersion => candidate !== undefined)
    .sort(compareVersions)
    .at(-1)?.original;
}

export function isProtocolVersionSupported(
  version: string,
  supportedVersions: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS,
): boolean {
  return supportedVersions.includes(version);
}

/** Returns the requested capabilities supported locally, preserving request order. */
export function negotiateCapabilities(
  requested: readonly ProtocolCapability[],
  supported: readonly ProtocolCapability[],
): ProtocolCapability[] {
  const supportedSet = new Set<string>(supported);
  return [...new Set(requested.filter((capability) => supportedSet.has(capability)))];
}
