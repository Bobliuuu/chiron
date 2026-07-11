import { deriveProfile, QUIZ_QUESTIONS } from "@/lib/quiz";
import { getProfile, upsertProfile } from "@/lib/supabase/profiles";

export const runtime = "nodejs";

// GET /api/profile?id=... -> the stored profile (or 404)
export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !isUuid(id)) {
    return Response.json({ error: "A profile id is required." }, { status: 400 });
  }

  try {
    const profile = await getProfile(id);
    if (!profile) {
      return Response.json({ error: "Profile not found." }, { status: 404 });
    }
    return Response.json({ profile });
  } catch (err) {
    console.error("[/api/profile GET] error:", err);
    return Response.json({ error: "Failed to load profile." }, { status: 500 });
  }
}

// POST /api/profile  { id, answers: {question_id: boolean}, city? }
// Derives preferences + ui_mode from the quiz answers and upserts the profile.
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  if (!isUuid(id)) {
    return Response.json(
      { error: "id must be a UUID (client-generated for now)." },
      { status: 400 },
    );
  }

  const answers = sanitizeAnswers(b.answers);
  const city =
    typeof b.city === "string" && b.city.trim() ? b.city.trim() : null;

  try {
    const profile = await upsertProfile(deriveProfile(id, answers, city));
    return Response.json({ profile }, { status: 201 });
  } catch (err) {
    console.error("[/api/profile POST] error:", err);
    return Response.json({ error: "Failed to save profile." }, { status: 500 });
  }
}

/** Keep only known question ids with boolean answers. */
function sanitizeAnswers(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (typeof raw !== "object" || raw === null) return out;
  const known = new Set(QUIZ_QUESTIONS.map((q) => q.id));
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (known.has(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
