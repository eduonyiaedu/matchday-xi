import { Resend } from "resend";

/**
 * Best-effort alert email — never throws. A missing RESEND_API_KEY (e.g. local dev) just logs
 * instead of sending, so nothing here can break the lineup-check job itself; losing the alert is
 * far better than losing the scoring run that triggered it.
 *
 * Returns whether the caller should treat this as "handled" (true for an actual successful send,
 * or for the deliberate not-configured case — no point retrying a config that isn't there) versus
 * a genuine transient failure (false) that's worth retrying on the next cron tick rather than
 * silently and permanently losing the founder's only signal that a fixture needs manual attention.
 */
export async function sendLineupAlert(params: {
  fixtureId: string;
  matchLabel: string;
  kickoffAt: Date;
  reason: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const adminUrl = `${appBaseUrl}/admin/lineups/${params.fixtureId}`;

  if (!apiKey || !to) {
    console.warn(
      `[lineup-alert] RESEND_API_KEY or ALERT_EMAIL_TO not set — skipping email. Would have alerted: ${params.matchLabel} (${params.reason})`,
    );
    return true;
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: "Matchday XI <onboarding@resend.dev>",
      to,
      subject: `Matchday XI — lineup fetch failed: ${params.matchLabel}`,
      text: [
        params.matchLabel,
        `Kickoff: ${params.kickoffAt.toISOString()}`,
        "",
        "Automated fetch couldn't get the official lineup.",
        `Enter it manually: ${adminUrl}`,
        "",
        `Reason: ${params.reason}`,
      ].join("\n"),
    });
    return true;
  } catch (error) {
    console.error("[lineup-alert] Failed to send alert email:", error);
    return false;
  }
}
