import type { ObjectStore } from "./object-store";
import { blobObjectStore } from "./storage-blob";
import { s3ObjectStore } from "./storage-s3";

/** A key that lives in S3 (`files/`) or private Blob (`blob/`), not in Postgres or on disk. */
export function isRemoteKey(key: string | null | undefined): key is string {
  return !!key && (key.startsWith("files/") || key.startsWith("blob/"));
}

export function remoteStore(key: string): ObjectStore {
  if (key.startsWith("blob/")) return blobObjectStore();
  return s3ObjectStore();
}
