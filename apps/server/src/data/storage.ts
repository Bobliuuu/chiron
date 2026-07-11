import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./client";

// Event image storage. Images live in a public Supabase Storage bucket and
// events reference them by URL (events.image_url) — nothing else in the
// pipeline touches them.

const BUCKET = "event-images";

/**
 * Store one image and return its public URL, or null when Supabase is not
 * configured (mock mode has no persistent storage; callers treat the image as
 * optional).
 */
export async function uploadEventImage(file: File): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const ext = extensionFor(file.type);
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;

  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      cacheControl: "31536000", // immutable content, unique path per upload
    });
  if (error) throw new Error(`uploadEventImage failed: ${error.message}`);

  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    default:
      return ".jpg";
  }
}
