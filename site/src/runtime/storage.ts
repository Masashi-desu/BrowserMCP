export const STORAGE_DATABASE_NAME = "browsermcp-site";
export const STORAGE_STORE_NAME = "safe-values";
export const STORAGE_DATABASE_VERSION = 3;
export const MAX_STORAGE_KEY_LENGTH = 120;
export const MAX_STORAGE_VALUE_BYTES = 32 * 1024;
export const MAX_STORAGE_DEPTH = 12;
export const MAX_STORAGE_COLLECTION_ITEMS = 500;
export const MAX_STORAGE_ENTRIES = 64;
export const MAX_STORAGE_TOTAL_BYTES = 256 * 1024;
export const MAX_STORAGE_SCAN_ENTRIES = MAX_STORAGE_ENTRIES * 4;
export const MAX_STORAGE_SCAN_BYTES = MAX_STORAGE_TOTAL_BYTES * 2;

export interface StoredValue {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: string;
  readonly bytes: number;
}

export interface StorageUsage {
  readonly entries: number;
  readonly totalBytes: number;
  readonly maxEntries: number;
  readonly maxTotalBytes: number;
}

export interface StorageWriteResult {
  readonly entry: StoredValue;
  readonly evictedKeys: readonly string[];
  readonly usage: StorageUsage;
}

const credentialKeyNames = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "auth",
  "authorization",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "privatekey",
  "credential",
  "cookie",
]);
const normalizedKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, "");
const forbiddenKey = (value: string): boolean => {
  const normalized = normalizedKey(value);
  return (
    credentialKeyNames.has(normalized) ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("credential") ||
    normalized.endsWith("privatekey")
  );
};
const prototypePollutionKey = /^(?:__proto__|prototype|constructor)$/u;
const forbiddenValue =
  /(?:\bbmp_[a-z0-9_-]+(?![a-z0-9_-])|\bbearer\s+\S+|\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|private[_-]?key|password|auth)=\S+)/iu;
const storageKeyPattern = /^[a-z0-9][a-z0-9._:/-]*$/iu;
const encoder = new TextEncoder();

const validateKey = (key: string): void => {
  if (key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH) {
    throw new Error(`Storage key must be 1–${MAX_STORAGE_KEY_LENGTH} characters.`);
  }
  if (!storageKeyPattern.test(key)) {
    throw new Error("Storage key contains unsupported characters.");
  }
  if (forbiddenKey(key)) {
    throw new Error("Secret-like values must not be stored by this demonstration tool.");
  }
};

const inspectValue = (value: unknown, depth: number, state: { count: number }): void => {
  if (depth > MAX_STORAGE_DEPTH) {
    throw new Error(`Storage value exceeds maximum depth ${MAX_STORAGE_DEPTH}.`);
  }
  state.count += 1;
  if (state.count > MAX_STORAGE_COLLECTION_ITEMS) {
    throw new Error(`Storage value exceeds ${MAX_STORAGE_COLLECTION_ITEMS} collection items.`);
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Storage numbers must be finite.");
    return;
  }
  if (typeof value === "string") {
    if (forbiddenValue.test(value)) {
      throw new Error("Secret-like strings must not be stored by this demonstration tool.");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectValue(item, depth + 1, state);
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Storage values must contain only plain JSON objects.");
    }
    for (const [nestedKey, item] of Object.entries(value as Record<string, unknown>)) {
      if (prototypePollutionKey.test(nestedKey)) {
        throw new Error("Prototype-mutating nested keys are not allowed in storage values.");
      }
      if (forbiddenKey(nestedKey)) {
        throw new Error("Secret-like nested keys must not be stored by this demonstration tool.");
      }
      inspectValue(item, depth + 1, state);
    }
    return;
  }
  throw new Error("Storage value must contain only JSON-compatible values.");
};

export const validateStorageEntry = (key: string, value: unknown): string => {
  validateKey(key);
  inspectValue(value, 0, { count: 0 });
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("Storage value must be JSON serializable.");
  }
  if (serialized === undefined) throw new Error("Storage value must be JSON serializable.");
  if (encoder.encode(serialized).byteLength > MAX_STORAGE_VALUE_BYTES) {
    throw new Error(`Storage value exceeds ${MAX_STORAGE_VALUE_BYTES} bytes.`);
  }
  return serialized;
};

const storedBytes = (key: string, serializedValue: string): number =>
  encoder.encode(key).byteLength + encoder.encode(serializedValue).byteLength + 64;

const canonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const validateStoredRecord = (raw: unknown, expectedKey?: string): StoredValue => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Stored entry is not an object.");
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "bytes,key,updatedAt,value") {
    throw new Error("Stored entry has an unexpected shape.");
  }
  if (typeof record.key !== "string") throw new Error("Stored entry key is invalid.");
  validateKey(record.key);
  if (expectedKey !== undefined && record.key !== expectedKey) {
    throw new Error("Stored entry key does not match the requested key.");
  }
  if (!canonicalTimestamp(record.updatedAt)) {
    throw new Error("Stored entry timestamp is invalid.");
  }
  const serialized = validateStorageEntry(record.key, record.value);
  const bytes = storedBytes(record.key, serialized);
  if (!Number.isSafeInteger(record.bytes) || record.bytes !== bytes) {
    throw new Error("Stored entry byte count is invalid.");
  }
  return {
    key: record.key,
    value: JSON.parse(serialized) as unknown,
    updatedAt: record.updatedAt,
    bytes,
  };
};

const usageFor = (entries: readonly StoredValue[]): StorageUsage => ({
  entries: entries.length,
  totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
  maxEntries: MAX_STORAGE_ENTRIES,
  maxTotalBytes: MAX_STORAGE_TOTAL_BYTES,
});

const openDatabase = (repairAttempted = false): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser context."));
      return;
    }
    const request = indexedDB.open(STORAGE_DATABASE_NAME, STORAGE_DATABASE_VERSION);
    let blocked = false;
    request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB."));
    request.onblocked = () => {
      blocked = true;
      reject(
        new Error("IndexedDB upgrade was blocked; close other tabs using this site and try again."),
      );
    };
    request.onupgradeneeded = (event) => {
      const hasStore = request.result.objectStoreNames.contains(STORAGE_STORE_NAME);
      const existingStore = hasStore
        ? request.transaction?.objectStore(STORAGE_STORE_NAME)
        : undefined;
      if (existingStore !== undefined && existingStore.keyPath !== "key") {
        request.result.deleteObjectStore(STORAGE_STORE_NAME);
        request.result.createObjectStore(STORAGE_STORE_NAME, { keyPath: "key" });
      } else if (!hasStore) {
        request.result.createObjectStore(STORAGE_STORE_NAME, { keyPath: "key" });
      } else if (event.oldVersion < STORAGE_DATABASE_VERSION) {
        // Older records did not have all current quota/tamper invariants. Fail closed on upgrade.
        existingStore?.clear();
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      let validSchema = database.objectStoreNames.contains(STORAGE_STORE_NAME);
      if (validSchema) {
        const transaction = database.transaction(STORAGE_STORE_NAME, "readonly");
        validSchema = transaction.objectStore(STORAGE_STORE_NAME).keyPath === "key";
      }
      if (validSchema) {
        resolve(database);
        return;
      }
      database.close();
      if (repairAttempted) {
        reject(new Error("IndexedDB storage schema could not be repaired."));
        return;
      }
      const removal = indexedDB.deleteDatabase(STORAGE_DATABASE_NAME);
      removal.onerror = () => reject(removal.error ?? new Error("IndexedDB repair failed."));
      removal.onblocked = () => reject(new Error("IndexedDB repair was blocked."));
      removal.onsuccess = () => {
        void openDatabase(true).then(resolve, reject);
      };
    };
  });

const transactionFailure = (transaction: IDBTransaction, fallback: string): Error =>
  transaction.error ?? new Error(fallback);

interface StorageScan {
  readonly entries: readonly StoredValue[];
  readonly failure?: Error;
}

const scanStorage = (store: IDBObjectStore, onComplete: (scan: StorageScan) => void): void => {
  const entries: StoredValue[] = [];
  let scannedEntries = 0;
  let scannedBytes = 0;
  let failure: Error | undefined;
  const request = store.openCursor();
  request.onerror = () => store.transaction.abort();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      onComplete({ entries, ...(failure === undefined ? {} : { failure }) });
      return;
    }
    scannedEntries += 1;
    let serializedRaw: string | undefined;
    try {
      serializedRaw = JSON.stringify(cursor.value) as string | undefined;
    } catch {
      serializedRaw = undefined;
    }
    scannedBytes +=
      serializedRaw === undefined
        ? MAX_STORAGE_SCAN_BYTES + 1
        : encoder.encode(serializedRaw).byteLength;
    if (scannedEntries > MAX_STORAGE_SCAN_ENTRIES || scannedBytes > MAX_STORAGE_SCAN_BYTES) {
      const boundFailure = new Error(
        "IndexedDB storage scan exceeded its safety bound; the Origin store was cleared.",
      );
      failure = boundFailure;
      const clear = store.clear();
      clear.onerror = () => store.transaction.abort();
      clear.onsuccess = () => onComplete({ entries: [], failure: boundFailure });
      return;
    }
    try {
      const entry = validateStoredRecord(cursor.value as unknown);
      if (cursor.primaryKey !== entry.key) {
        cursor.delete();
      } else {
        entries.push(entry);
      }
    } catch {
      // Cursor deletion uses the actual primary key, including malformed non-string keys.
      cursor.delete();
    }
    cursor.continue();
  };
};

export const putStoredValue = async (
  key: string,
  value: unknown,
  options: { readonly now?: Date } = {},
): Promise<StorageWriteResult> => {
  const serialized = validateStorageEntry(key, value);
  const now = options.now ?? new Date();
  const updatedAt = now.toISOString();
  if (!canonicalTimestamp(updatedAt)) throw new Error("Storage timestamp is invalid.");
  const entry: StoredValue = {
    key,
    value: JSON.parse(serialized) as unknown,
    updatedAt,
    bytes: storedBytes(key, serialized),
  };
  const database = await openDatabase();
  try {
    return await new Promise<StorageWriteResult>((resolve, reject) => {
      const transaction = database.transaction(STORAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      let result: StorageWriteResult | undefined;
      let scanFailure: Error | undefined;
      scanStorage(store, (scan) => {
        scanFailure = scan.failure;
        if (scanFailure !== undefined) return;
        const valid = scan.entries.filter((existing) => existing.key !== key);
        valid.sort(
          (left, right) =>
            left.updatedAt.localeCompare(right.updatedAt) || left.key.localeCompare(right.key),
        );
        const evictedKeys: string[] = [];
        const projected = [...valid, entry];
        while (
          projected.length > MAX_STORAGE_ENTRIES ||
          usageFor(projected).totalBytes > MAX_STORAGE_TOTAL_BYTES
        ) {
          const evicted = projected.shift();
          if (evicted === undefined || evicted.key === entry.key) {
            transaction.abort();
            return;
          }
          store.delete(evicted.key);
          evictedKeys.push(evicted.key);
        }
        store.put(entry);
        result = { entry, evictedKeys, usage: usageFor(projected) };
      });
      transaction.oncomplete = () => {
        if (scanFailure !== undefined) reject(scanFailure);
        else if (result === undefined) reject(new Error("IndexedDB write produced no result."));
        else resolve(result);
      };
      transaction.onerror = () =>
        reject(transactionFailure(transaction, "IndexedDB write failed."));
      transaction.onabort = () =>
        reject(transactionFailure(transaction, "IndexedDB write aborted."));
    });
  } finally {
    database.close();
  }
};

export const getStoredValue = async (key: string): Promise<StoredValue | undefined> => {
  validateKey(key);
  const database = await openDatabase();
  try {
    return await new Promise<StoredValue | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      const request = store.get(key);
      let result: StoredValue | undefined;
      let validationError: Error | undefined;
      request.onerror = () => transaction.abort();
      request.onsuccess = () => {
        if (request.result === undefined) return;
        try {
          result = validateStoredRecord(request.result as unknown, key);
        } catch (error) {
          validationError = new Error(
            `Stored entry failed validation and was removed: ${error instanceof Error ? error.message : "invalid record"}`,
          );
          store.delete(key);
        }
      };
      transaction.oncomplete = () => {
        if (validationError !== undefined) reject(validationError);
        else resolve(result);
      };
      transaction.onerror = () => reject(transactionFailure(transaction, "IndexedDB read failed."));
      transaction.onabort = () =>
        reject(transactionFailure(transaction, "IndexedDB read aborted."));
    });
  } finally {
    database.close();
  }
};

export const deleteStoredValue = async (key: string): Promise<boolean> => {
  validateKey(key);
  const database = await openDatabase();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = database.transaction(STORAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      const request = store.getKey(key);
      let existed = false;
      request.onerror = () => transaction.abort();
      request.onsuccess = () => {
        existed = request.result !== undefined;
        if (existed) store.delete(key);
      };
      transaction.oncomplete = () => resolve(existed);
      transaction.onerror = () =>
        reject(transactionFailure(transaction, "IndexedDB delete failed."));
      transaction.onabort = () =>
        reject(transactionFailure(transaction, "IndexedDB delete aborted."));
    });
  } finally {
    database.close();
  }
};

export const getStorageUsage = async (): Promise<StorageUsage> => {
  const database = await openDatabase();
  try {
    return await new Promise<StorageUsage>((resolve, reject) => {
      const transaction = database.transaction(STORAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORAGE_STORE_NAME);
      const valid: StoredValue[] = [];
      let scanFailure: Error | undefined;
      scanStorage(store, (scan) => {
        valid.push(...scan.entries);
        scanFailure = scan.failure;
      });
      transaction.oncomplete = () => {
        if (scanFailure !== undefined) reject(scanFailure);
        else resolve(usageFor(valid));
      };
      transaction.onerror = () =>
        reject(transactionFailure(transaction, "IndexedDB usage failed."));
      transaction.onabort = () =>
        reject(transactionFailure(transaction, "IndexedDB usage aborted."));
    });
  } finally {
    database.close();
  }
};
