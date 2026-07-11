import { Resend } from "resend";
import type { EventRecord } from "@chiron/shared";
import { env } from "../config";

export interface SendEventsResult {
  sent: boolean;
  id?: string;
  error?: string;
}

/** Send a "cool events you should go to" digest to the given address. */
export async function sendEventsDigest(
  to: string,
  events: EventRecord[],
): Promise<SendEventsResult> {
  if (events.length === 0) {
    return { sent: false, error: "No upcoming events to send." };
  }

  const resend = new Resend(env.resendApiKey);
  const subject = `${events.length} cool events you should check out`;

  try {
    const { data, error } = await resend.emails.send({
      from: env.emailFrom,
      to,
      subject,
      html: renderHtml(events),
      text: renderText(events),
    });
    if (error) {
      return { sent: false, error: error.message };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Failed to send email.",
    };
  }
}

function whenWhereCost(e: EventRecord): { when: string; where: string; cost: string } {
  const when = new Date(e.start_time).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const where = e.is_online
    ? "Online"
    : [e.location_name, e.city].filter(Boolean).join(", ") || "Location TBD";
  const cost = e.is_free ? "Free" : e.cost_note || "Paid";
  return { when, where, cost };
}

function renderText(events: EventRecord[]): string {
  const lines = events.map((e, i) => {
    const { when, where, cost } = whenWhereCost(e);
    return `${i + 1}. ${e.title}\n   ${when} · ${where} · ${cost}\n   ${e.summary}`;
  });
  return `Hi! Here are some community events coming up that you might love:\n\n${lines.join(
    "\n\n",
  )}\n\n— Chiron`;
}

function renderHtml(events: EventRecord[]): string {
  const cards = events
    .map((e) => {
      const { when, where, cost } = whenWhereCost(e);
      return `
      <tr>
        <td style="padding:16px;border:1px solid #e2e8f0;border-radius:12px;">
          <div style="font-size:16px;font-weight:600;color:#0f172a;">${escapeHtml(e.title)}</div>
          <div style="margin-top:4px;font-size:13px;color:#64748b;">
            ${escapeHtml(when)} &middot; ${escapeHtml(where)} &middot; ${escapeHtml(cost)}
          </div>
          <div style="margin-top:8px;font-size:14px;color:#334155;">${escapeHtml(e.summary)}</div>
        </td>
      </tr>
      <tr><td style="height:12px;"></td></tr>`;
    })
    .join("");

  return `<!doctype html>
  <html>
    <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;">
        <tr><td>
          <div style="font-size:20px;font-weight:700;color:#0f172a;">Cool events for you 🎉</div>
          <div style="margin-top:4px;font-size:14px;color:#64748b;">
            A few community events coming up that you might love.
          </div>
          <table role="presentation" width="100%" style="margin-top:16px;border-collapse:separate;border-spacing:0;">
            ${cards}
          </table>
          <div style="margin-top:16px;font-size:12px;color:#94a3b8;">Sent by Chiron, your community event assistant.</div>
        </td></tr>
      </table>
    </body>
  </html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
