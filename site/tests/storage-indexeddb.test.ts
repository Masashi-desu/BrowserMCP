import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteStoredValue,
  getStorageUsage,
  getStoredValue,
  MAX_STORAGE_ENTRIES,
  MAX_STORAGE_SCAN_BYTES,
  MAX_STORAGE_SCAN_ENTRIES,
  MAX_STORAGE_TOTAL_BYTES,
  putStoredValue,
  STORAGE_DATABASE_NAME,
  STORAGE_DATABASE_VERSION,
  STORAGE_STORE_NAME,
} from "../src/runtime/storage.js";

const deleteDatabase = async (): Promise<void> =>
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(STORAGE_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Database cleanup failed."));
    request.onblocked = () => reject(new Error("Database cleanup was blocked."));
  });

const tamper = async (record: unknown): Promise<void> => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STORAGE_DATABASE_NAME, STORAGE_DATABASE_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Database open failed."));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORAGE_STORE_NAME, "readwrite");
      transaction.objectStore(STORAGE_STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Tamper write failed."));
    });
  } finally {
    database.close();
  }
};

const tamperMany = async (records: readonly unknown[]): Promise<void> => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STORAGE_DATABASE_NAME, STORAGE_DATABASE_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Database open failed."));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      for (const record of records) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Bulk tamper failed."));
    });
  } finally {
    database.close();
  }
};

beforeEach(deleteDatabase);
afterEach(deleteDatabase);

describe("IndexedDB safe storage", () => {
  it("writes canonical records and revalidates them on read", async () => {
    const write = await putStoredValue("example.note", { text: "safe", count: 1 });
    expect(write.entry.bytes).toBeGreaterThan(0);
    expect(write.usage).toMatchObject({ entries: 1, totalBytes: write.entry.bytes });
    await expect(getStoredValue("example.note")).resolves.toEqual(write.entry);
  });

  it("removes a directly injected record that fails shape and nested-secret validation", async () => {
    await putStoredValue("example.note", { text: "safe" });
    await tamper({
      key: "example.note",
      value: { nested: { access_token: "injected" } },
      updatedAt: new Date(0).toISOString(),
      bytes: 1,
    });
    await expect(getStoredValue("example.note")).rejects.toThrow(/failed validation/u);
    await expect(getStoredValue("example.note")).resolves.toBeUndefined();
  });

  it("keeps replacement atomic when a new value is rejected", async () => {
    const original = await putStoredValue("replace.me", { value: "original" });
    await expect(putStoredValue("replace.me", { authorization: "unsafe" })).rejects.toThrow(
      /Secret-like/u,
    );
    await expect(getStoredValue("replace.me")).resolves.toEqual(original.entry);
  });

  it("rejects BrowserMCP token strings whose final character is an underscore or hyphen", async () => {
    await expect(putStoredValue("token.trailing-underscore", "bmp_pair_abc_")).rejects.toThrow(
      /Secret-like/u,
    );
    await expect(putStoredValue("token.trailing-hyphen", "bmp_pair_abc-")).rejects.toThrow(
      /Secret-like/u,
    );
  });

  it("evicts deterministically at the per-Origin entry limit", async () => {
    for (let index = 0; index <= MAX_STORAGE_ENTRIES; index += 1) {
      await putStoredValue(
        `entry.${index.toString().padStart(3, "0")}`,
        { index },
        {
          now: new Date(index * 1_000),
        },
      );
    }
    const usage = await getStorageUsage();
    expect(usage.entries).toBe(MAX_STORAGE_ENTRIES);
    await expect(getStoredValue("entry.000")).resolves.toBeUndefined();
    await expect(getStoredValue("entry.064")).resolves.toBeDefined();
  });

  it("evicts oldest records before exceeding the aggregate byte quota", async () => {
    const payload = "x".repeat(30_000);
    let lastEvictions: readonly string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const result = await putStoredValue(
        `large.${index}`,
        { payload },
        {
          now: new Date(index * 1_000),
        },
      );
      lastEvictions = result.evictedKeys;
    }
    const usage = await getStorageUsage();
    expect(usage.totalBytes).toBeLessThanOrEqual(MAX_STORAGE_TOTAL_BYTES);
    expect(lastEvictions.length).toBeGreaterThan(0);
    await expect(getStoredValue("large.0")).resolves.toBeUndefined();
    await expect(getStoredValue("large.9")).resolves.toBeDefined();
  });

  it("deletes one validated key atomically", async () => {
    await putStoredValue("delete.me", { safe: true });
    await expect(deleteStoredValue("delete.me")).resolves.toBe(true);
    await expect(deleteStoredValue("delete.me")).resolves.toBe(false);
    await expect(getStorageUsage()).resolves.toMatchObject({ entries: 0, totalBytes: 0 });
  });

  it("deletes malformed non-string primary keys while scanning with a cursor", async () => {
    await putStoredValue("valid.entry", { safe: true });
    await tamper({
      key: 7,
      value: { injected: true },
      updatedAt: new Date(0).toISOString(),
      bytes: 1,
    });
    await expect(getStorageUsage()).resolves.toMatchObject({ entries: 1 });

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(STORAGE_DATABASE_NAME, STORAGE_DATABASE_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Database open failed."));
    });
    const injected = await new Promise<unknown>((resolve, reject) => {
      const request = database
        .transaction(STORAGE_STORE_NAME)
        .objectStore(STORAGE_STORE_NAME)
        .get(7);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Injected read failed."));
    });
    database.close();
    expect(injected).toBeUndefined();
  });

  it("clears fail-closed when an Origin injects more records than the scan bound", async () => {
    await putStoredValue("seed.entry", { safe: true });
    await tamperMany(
      Array.from({ length: MAX_STORAGE_SCAN_ENTRIES + 1 }, (_, index) => ({
        key: index + 10_000,
        value: null,
        updatedAt: new Date(0).toISOString(),
        bytes: 1,
      })),
    );
    await expect(getStorageUsage()).rejects.toThrow(/scan exceeded/u);
    await expect(getStorageUsage()).resolves.toMatchObject({ entries: 0, totalBytes: 0 });
  });

  it("clears fail-closed when injected record bytes exceed the scan bound", async () => {
    await putStoredValue("seed.entry", { safe: true });
    await tamper({
      key: "oversized.injected",
      value: "x".repeat(MAX_STORAGE_SCAN_BYTES + 1),
      updatedAt: new Date(0).toISOString(),
      bytes: 1,
    });
    await expect(getStorageUsage()).rejects.toThrow(/scan exceeded/u);
    await expect(getStorageUsage()).resolves.toMatchObject({ entries: 0 });
  });

  it("repairs an injected mismatched primary-key schema before use", async () => {
    await deleteDatabase();
    const malformed = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(STORAGE_DATABASE_NAME, STORAGE_DATABASE_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORAGE_STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Malformed database failed."));
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = malformed.transaction(STORAGE_STORE_NAME, "readwrite");
      transaction.objectStore(STORAGE_STORE_NAME).put(
        {
          key: "declared-key",
          value: { injected: true },
          updatedAt: new Date(0).toISOString(),
          bytes: 1,
        },
        "different-primary-key",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Mismatch write failed."));
    });
    malformed.close();

    await expect(getStorageUsage()).resolves.toMatchObject({ entries: 0, totalBytes: 0 });
  });

  it("rejects promptly when an older database connection blocks upgrade", async () => {
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(STORAGE_DATABASE_NAME, STORAGE_DATABASE_VERSION - 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORAGE_STORE_NAME, { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Old database open failed."));
    });

    await expect(getStorageUsage()).rejects.toThrow(/close other tabs/u);
    blocker.close();
    await expect(getStorageUsage()).resolves.toMatchObject({ entries: 0 });
  });
});
