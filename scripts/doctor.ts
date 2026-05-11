#!/usr/bin/env node
// scripts/doctor.ts — sanity-check dev infrastructure before the API/worker
// have a chance to silently fall back to mock providers. Exit code:
//   0 = all checks pass (or only optional ones failed)
//   1 = a check the user explicitly opted into (env says "use real X") failed
//
// Run via: npm run doctor
import * as net from 'net';
import * as path from 'path';
import * as dotenv from 'dotenv';

// override:true so .env is authoritative — otherwise stale empty values
// inherited from a previous shell `export` sneak through and look like
// missing config, masking the real state.
dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true,
});

type Status = 'ok' | 'warn' | 'FAIL';
interface Check {
  name: string;
  status: Status;
  info: string;
}

const checks: Check[] = [];
let hardFail = false;

function pass(name: string, info: string): void {
  checks.push({ name, status: 'ok', info });
}
function warn(name: string, info: string): void {
  checks.push({ name, status: 'warn', info });
}
function fail(name: string, info: string): void {
  checks.push({ name, status: 'FAIL', info });
  hardFail = true;
}

async function tcpProbe(
  host: string,
  port: number,
  timeoutMs = 1500,
): Promise<{ ok: boolean; err?: string }> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean, err?: string): void => {
      sock.destroy();
      resolve({ ok, err });
    };
    sock.setTimeout(timeoutMs);
    sock.once('error', (e) => done(false, e.message));
    sock.once('timeout', () => done(false, 'timeout'));
    sock.connect(port, host, () => done(true));
  });
}

async function httpProbe(
  url: string,
  timeoutMs = 3000,
): Promise<{ ok: boolean; status?: number; err?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, err: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

async function main(): Promise<void> {
  // ── env presence ─────────────────────────────────────────────
  if (process.env.DATABASE_URL) pass('env.DATABASE_URL', '(set)');
  else fail('env.DATABASE_URL', 'missing — Prisma will fail');

  // ── postgres ─────────────────────────────────────────────────
  if (process.env.DATABASE_URL) {
    const m = process.env.DATABASE_URL.match(/@([^:/]+):(\d+)\//);
    if (m) {
      const r = await tcpProbe(m[1], Number(m[2]));
      r.ok
        ? pass('postgres', `${m[1]}:${m[2]}`)
        : fail('postgres', `${m[1]}:${m[2]} — ${r.err}`);
    }
  }

  // ── redis ────────────────────────────────────────────────────
  const redisHost = process.env.REDIS_HOST ?? 'localhost';
  const redisPort = Number(process.env.REDIS_PORT ?? 6379);
  const r1 = await tcpProbe(redisHost, redisPort);
  r1.ok
    ? pass('redis', `${redisHost}:${redisPort}`)
    : fail('redis', `${redisHost}:${redisPort} — ${r1.err}`);

  // ── minio / s3 ───────────────────────────────────────────────
  const s3 = process.env.S3_ENDPOINT;
  if (s3) {
    const u = new URL(s3);
    const r = await tcpProbe(
      u.hostname,
      Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
    );
    r.ok ? pass('s3', s3) : fail('s3', `${s3} — ${r.err}`);
  } else {
    warn('s3', 'S3_ENDPOINT unset — will use local-disk fallback');
  }

  // ── transcription provider ───────────────────────────────────
  const ai = (process.env.AI_PROVIDER ?? 'mock').toLowerCase();
  if (ai === 'whisper') {
    const ep = process.env.WHISPER_ENDPOINT ?? 'http://localhost:9001';
    const r = await httpProbe(`${ep.replace(/\/+$/, '')}/health`);
    r.ok
      ? pass('whisper', `${ep} (${r.status})`)
      : fail('whisper', `AI_PROVIDER=whisper but ${ep}/health — ${r.err ?? r.status}`);
  } else if (ai === 'mock') {
    warn('whisper', 'AI_PROVIDER=mock — transcription will be deterministic SAMPLE TEXT');
  } else {
    warn('whisper', `AI_PROVIDER=${ai} — unknown provider`);
  }

  // ── llm provider ─────────────────────────────────────────────
  const llm = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  if (llm === 'claude') {
    const k = process.env.ANTHROPIC_API_KEY;
    if (!k) fail('claude', 'LLM_PROVIDER=claude but ANTHROPIC_API_KEY missing');
    else if (!k.startsWith('sk-ant-'))
      fail('claude', 'ANTHROPIC_API_KEY does not start with "sk-ant-"');
    else
      pass(
        'claude',
        `key set (${k.slice(0, 11)}…), model=${process.env.LLM_MODEL ?? 'claude-sonnet-4-6'}`,
      );
  } else if (llm === 'mock') {
    warn('claude', 'LLM_PROVIDER=mock — summaries will be GENERIC TEMPLATE TEXT');
  }

  // ── api ──────────────────────────────────────────────────────
  const apiPort = Number(process.env.API_PORT ?? 3000);
  const r2 = await tcpProbe('localhost', apiPort, 800);
  r2.ok
    ? pass('api', `:${apiPort} (running)`)
    : warn('api', `:${apiPort} — not running yet`);

  // ── report ───────────────────────────────────────────────────
  const wpad = (s: string): string => s.padEnd(12, ' ');
  const ic: Record<Status, string> = { ok: '✓', warn: '⚠', FAIL: '✗' };
  const co: Record<Status, string> = {
    ok: '\x1b[32m',
    warn: '\x1b[33m',
    FAIL: '\x1b[31m',
  };
  const reset = '\x1b[0m';
  console.log();
  console.log('m-secretary doctor');
  console.log('───────────────────────────────────────────');
  for (const c of checks) {
    console.log(`${co[c.status]}${ic[c.status]}${reset} ${wpad(c.name)} ${c.info}`);
  }
  console.log();
  if (hardFail) {
    console.log('\x1b[31m✗ One or more required services are misconfigured.\x1b[0m');
    console.log('  Fix the FAIL lines above before starting api/worker —');
    console.log('  silent mock fallback is no longer the contract.');
    process.exit(1);
  }
  console.log('\x1b[32m✓ All required services reachable.\x1b[0m');
}

void main();
