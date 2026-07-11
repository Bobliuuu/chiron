import type { VoiceCallRecord } from "@chiron/shared";

/** Pull goals/motivations from a call transcript or summary (demo heuristic). */
export function extractOntologyFromCall(input: {
  callId: string;
  eventTitle?: string | null;
  transcript?: string | null;
  summary?: string | null;
}): VoiceCallRecord {
  const text = [input.summary, input.transcript].filter(Boolean).join("\n");
  const goals = extractGoals(text);
  const motivations = extractMotivations(text);

  return {
    call_id: input.callId,
    type: "event_checkin",
    event_title: input.eventTitle ?? null,
    recorded_at: new Date().toISOString(),
    summary: input.summary ?? summarize(text),
    event_goals: goals,
    motivations,
    raw_transcript: input.transcript ?? null,
  };
}

/** Demo mock outcome when VAPI is not configured. */
export function mockEventCheckinRecord(
  callId: string,
  eventTitle: string,
): VoiceCallRecord {
  return {
    call_id: callId,
    type: "event_checkin",
    event_title: eventTitle,
    recorded_at: new Date().toISOString(),
    summary:
      "Maria wants groceries for the week and hopes to meet other families at the food bank.",
    event_goals: [
      "pick up groceries for the week",
      "meet other families in the community",
    ],
    motivations: ["food security", "community connection"],
    raw_transcript:
      "AI: The Markham food bank event is coming up — what do you want to get out of it?\n" +
      "User: I need groceries for the week, and I'd like to meet other families.",
  };
}

function extractGoals(text: string): string[] {
  const goals: string[] = [];
  const patterns = [
    /i (?:want|need|hope) to ([^.?\n]+)/gi,
    /looking to ([^.?\n]+)/gi,
    /get out of (?:it|this)[^.?\n]*?([^.?\n]+)/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const goal = match[1]?.trim();
      if (goal && goal.length > 5 && goal.length < 120) goals.push(goal);
    }
  }
  return [...new Set(goals)].slice(0, 5);
}

function extractMotivations(text: string): string[] {
  const motivations: string[] = [];
  const keywords: Record<string, string> = {
    groceries: "food security",
    food: "food security",
    meet: "community connection",
    families: "family support",
    friends: "social connection",
    free: "affordability",
    wheelchair: "accessibility",
    quiet: "sensory comfort",
  };
  const lower = text.toLowerCase();
  for (const [word, motivation] of Object.entries(keywords)) {
    if (lower.includes(word)) motivations.push(motivation);
  }
  return [...new Set(motivations)];
}

function summarize(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
}
