import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Private file storage (Supabase Storage), server-side only — service-role access, never exposed
 * to the browser. Files are handed out through short-lived signed links.
 */
export const EXPORTS_BUCKET = "exports";

let client: SupabaseClient | null = null;
let bucketReady = false;

function storageClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return client;
}

/** Creates the private exports bucket the first time it's needed. */
async function ensureBucket() {
  if (bucketReady) return;
  const storage = storageClient().storage;
  const { data } = await storage.getBucket(EXPORTS_BUCKET);
  if (!data) {
    const { error } = await storage.createBucket(EXPORTS_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Couldn't create storage bucket: ${error.message}`);
  }
  bucketReady = true;
}

export async function uploadFile(path: string, file: Buffer, contentType: string) {
  await ensureBucket();
  const { error } = await storageClient().storage.from(EXPORTS_BUCKET).upload(path, file, { contentType, upsert: true });
  if (error) throw new Error(`Upload of ${path} failed: ${error.message}`);
}

/** A time-limited download link (default 7 days). `downloadAs` sets the saved file's name. */
export async function signedDownloadUrl(path: string, opts: { expiresInSeconds?: number; downloadAs?: string } = {}) {
  const { data, error } = await storageClient()
    .storage.from(EXPORTS_BUCKET)
    .createSignedUrl(path, opts.expiresInSeconds ?? 7 * 24 * 60 * 60, { download: opts.downloadAs ?? true });
  if (error || !data) throw new Error(`Couldn't create a download link for ${path}: ${error?.message}`);
  return data.signedUrl;
}

/** Deletes every file under a folder (non-recursive — export folders are flat). */
export async function removeFolder(prefix: string) {
  const storage = storageClient().storage.from(EXPORTS_BUCKET);
  const { data, error } = await storage.list(prefix, { limit: 1000 });
  if (error || !data || data.length === 0) return;
  await storage.remove(data.map((f) => `${prefix}/${f.name}`));
}

/** The folders directly under a prefix. */
export async function listFolders(prefix: string): Promise<string[]> {
  const { data, error } = await storageClient().storage.from(EXPORTS_BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  return data.filter((f) => f.id === null).map((f) => f.name);
}
