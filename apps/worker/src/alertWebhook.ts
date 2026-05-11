// Best-effort alert webhook fired when a meeting is marked FAILED.
//
// Why best-effort: alerting must NEVER block the primary failure path.
// A meeting going to FAILED is already a degraded state; if Slack/Discord
// is down, swallowing the alert error is correct. Failures are still
// recorded in pino logs for postmortem.
//
// Two formats supported (auto-detected from the URL):
//   - Discord:  POST {"content": "..."}    (URL contains "discord.com")
//   - Slack:    POST {"text": "..."}       (everything else)
//
// Config (env, both optional — leave unset to disable):
//   ALERT_WEBHOOK_URL   the webhook URL; presence enables alerts
//   ALERT_ENV_LABEL     short tag prepended to messages, e.g. "prod" / "staging"
import { logger } from './logger';
import { redactSecrets } from './redactSecrets';

const url = process.env.ALERT_WEBHOOK_URL;
const envLabel = process.env.ALERT_ENV_LABEL ?? 'msec';
const enabled = !!url;
const TIMEOUT_MS = 3_000;

export interface MeetingFailedAlert {
  meetingId: string;
  queue: string;
  reason: string;
}

export async function alertMeetingFailed(input: MeetingFailedAlert): Promise<void> {
  if (!enabled) return;

  // Same redactor used for the persisted failureReason — no point alerting
  // a Slack channel with an embedded API key the user just rotated.
  const safeReason = redactSecrets(input.reason).slice(0, 800);
  const text =
    `🚨 *m-secretary [${envLabel}]* meeting marked FAILED\n` +
    `• meeting: \`${input.meetingId}\`\n` +
    `• queue:   \`${input.queue}\`\n` +
    `• reason:  ${safeReason}`;

  const isDiscord = url!.includes('discord.com');
  const body = isDiscord ? { content: text } : { text };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, meetingId: input.meetingId },
        'alert.webhook.nonOk',
      );
    }
  } catch (err) {
    // Swallow — see file header. We surface it in logs but never re-throw.
    logger.warn(
      { err: (err as Error).message, meetingId: input.meetingId },
      'alert.webhook.failed',
    );
  } finally {
    clearTimeout(t);
  }
}
