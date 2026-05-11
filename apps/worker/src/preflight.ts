// Preflight: validate that whichever providers config selected are actually
// reachable / configured. Refuse to start otherwise. The whole point is to
// surface misconfiguration LOUD at boot rather than silently producing mock
// content during a real meeting.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config';
import { logger } from './logger';

export interface PreflightResult {
  aiProvider: string;
  llmProvider: string;
  llmModel: string;
  whisperEndpoint?: string;
  whisperReachable?: boolean;
  anthropicKeyPresent?: boolean;
  /**
   * undefined = not checked, true = 1-token ping succeeded, false = ping
   * failed transiently (network/5xx) and we let boot continue. Auth-class
   * failures (401/403/404) throw instead of setting this false.
   */
  anthropicLiveCheck?: boolean;
}

interface CheckSuccess<K extends keyof PreflightResult> {
  ok: true;
  patch: Pick<PreflightResult, K>;
}
interface CheckFailure {
  ok: false;
  /** Single-line, actionable message — printed verbatim in the aggregate error. */
  reason: string;
}
type CheckResult<K extends keyof PreflightResult> = CheckSuccess<K> | CheckFailure;

/**
 * Run all checks in parallel and report ALL failures at once.
 *
 * Why allSettled-style aggregation instead of `Promise.all` short-circuit:
 * if both whisper AND the Anthropic key are misconfigured, a fail-fast
 * preflight surfaces only one problem per boot — user fixes it, restarts,
 * sees the next one, restarts again. Aggregating means one boot = one
 * complete punch list of what's broken.
 */
export async function runPreflight(): Promise<PreflightResult> {
  // Production guard FIRST. If NODE_ENV=production and any provider is the
  // mock, refuse to even attempt the connectivity checks — the boot will
  // exit and we want the operator to see "production + mock = nope" without
  // a wall of secondary failures in front of it.
  refuseMockInProduction();

  const [whisper, claude] = await Promise.all([checkWhisper(), checkClaude()]);

  // Combined-throw branch first so the success branch can spread .patch
  // without TS narrowing complaints from the discriminated union.
  if (!whisper.ok || !claude.ok) {
    const reasons = [
      whisper.ok ? null : whisper.reason,
      claude.ok ? null : claude.reason,
    ].filter((r): r is string => r !== null);
    throw new Error('preflight failed:\n  - ' + reasons.join('\n  - '));
  }

  return {
    aiProvider: config.aiProvider,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    ...whisper.patch,
    ...claude.patch,
  };
}

// Mock providers are dev-only by design. In production they would silently
// produce template text from real meetings, which is the exact failure mode
// the no-fallback contract was meant to eliminate. Flipping LLM_PROVIDER=mock
// in prod (whether by accident or "to debug") would re-introduce it.
function refuseMockInProduction(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const offenders: string[] = [];
  if (config.aiProvider === 'mock') offenders.push('AI_PROVIDER=mock');
  if (config.llmProvider === 'mock') offenders.push('LLM_PROVIDER=mock');
  if (offenders.length === 0) return;
  throw new Error(
    `NODE_ENV=production but ${offenders.join(' and ')} — mock providers are dev-only ` +
      'and will produce TEMPLATE TEXT in place of real transcripts/summaries. ' +
      'Set the providers to whisper/claude (and configure their endpoints) before deploying.',
  );
}

// ── transcription ──────────────────────────────────────────────────
async function checkWhisper(): Promise<
  CheckResult<'whisperEndpoint' | 'whisperReachable'>
> {
  if (config.aiProvider !== 'whisper') {
    if (config.aiProvider === 'mock') {
      logger.warn(
        {},
        '⚠ AI_PROVIDER=mock — transcription will produce DETERMINISTIC SAMPLE TEXT, not real audio',
      );
    }
    return { ok: true, patch: {} };
  }

  const endpoint = config.whisperEndpoint;
  const url = `${endpoint.replace(/\/+$/, '')}/health`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      throw new Error(`whisper /health returned ${res.status}`);
    }
    return {
      ok: true,
      patch: { whisperEndpoint: endpoint, whisperReachable: true },
    };
  } catch (err) {
    return {
      ok: false,
      reason:
        `AI_PROVIDER=whisper but ${url} is unreachable (${(err as Error).message}). ` +
        `Start it with:  docker compose -f infra/docker-compose.yml --profile ai up -d whisper`,
    };
  }
}

// ── llm ────────────────────────────────────────────────────────────
async function checkClaude(): Promise<
  CheckResult<'anthropicKeyPresent' | 'anthropicLiveCheck'>
> {
  if (config.llmProvider !== 'claude') {
    if (config.llmProvider === 'mock') {
      logger.warn(
        {},
        '⚠ LLM_PROVIDER=mock — summaries will be GENERIC TEMPLATE TEXT, not based on transcript',
      );
    }
    return { ok: true, patch: {} };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      reason:
        'LLM_PROVIDER=claude but ANTHROPIC_API_KEY is not set. ' +
        'Add it to the root .env (NOT apps/worker/.env — that file is overwritten by sync:env).',
    };
  }
  if (!key.startsWith('sk-ant-')) {
    return {
      ok: false,
      reason: `ANTHROPIC_API_KEY does not look like an Anthropic key (expected prefix "sk-ant-", got "${key.slice(0, 10)}...")`,
    };
  }

  // Live 1-token ping. Catches expired/revoked/typo'd-after-prefix keys
  // and invalid model IDs immediately, instead of letting every summarize
  // job burn 3 attempts × 10s exponential backoff before the meeting
  // finally goes FAILED ~30 minutes later. Costs ~$0.0001/boot.
  try {
    const live = await pingAnthropic(key, config.llmModel);
    return {
      ok: true,
      patch: { anthropicKeyPresent: true, anthropicLiveCheck: live },
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/**
 * Issue a minimal 1-token messages.create against Anthropic. Returns true
 * on success, false on transient failure (network/5xx — boot continues
 * because Anthropic's status is outside our control). THROWS on auth-class
 * failures (401/403/404 invalid model) — these are config bugs that need
 * human attention before any real work is attempted.
 */
async function pingAnthropic(apiKey: string, model: string): Promise<boolean> {
  // 5s budget. Anthropic latency for a 1-token reply is well under 1s in
  // practice; the cap protects boot from a hung TLS handshake.
  const client = new Anthropic({ apiKey, timeout: 5_000, maxRetries: 0 });
  try {
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message = (err as Error).message ?? String(err);
    // 401 = bad key, 403 = key lacks permission, 404 = bad model id.
    // All are config bugs the user must fix before starting.
    if (status === 401 || status === 403 || status === 404) {
      throw new Error(
        `Anthropic preflight failed (HTTP ${status}): ${message}. ` +
          `Check ANTHROPIC_API_KEY and LLM_MODEL=${model}.`,
      );
    }
    // Transient: network blip, 5xx, 429 rate limit, or timeout. Don't block
    // boot — the worker can still process queued jobs once Anthropic recovers,
    // and a hard fail here would create a new outage longer than Anthropic's.
    logger.warn(
      { err: message, status },
      '⚠ Anthropic preflight ping failed transiently — boot will continue',
    );
    return false;
  }
}
