/** A single voice call outcome stored on the user's profile ontology. */
export interface VoiceCallRecord {
  call_id: string;
  type: "event_checkin" | "organizer_outreach";
  event_title?: string | null;
  recorded_at: string;
  summary?: string | null;
  /** What the user said they want to get out of the event. */
  event_goals?: string[];
  motivations?: string[];
  raw_transcript?: string | null;
}

/**
 * Learned preferences from outbound/inbound voice conversations.
 * Grows over time as Chiron calls users or they call in.
 */
export interface VoiceOntology {
  calls: VoiceCallRecord[];
  /** Merged goals across calls — used for matching users to each other. */
  event_goals: string[];
  motivations: string[];
}

export const EMPTY_VOICE_ONTOLOGY: VoiceOntology = {
  calls: [],
  event_goals: [],
  motivations: [],
};
