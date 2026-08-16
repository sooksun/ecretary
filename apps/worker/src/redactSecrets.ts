// Redact obvious secrets from a string before it crosses a trust boundary
// (e.g. is persisted to Meeting.failureReason and surfaced to a mobile
// client). Defense-in-depth — the goal is not to make this string safe to
// publish on the open internet, but to ensure that an Anthropic SDK error
// that happens to dump request headers, or a Postgres error that includes a
// connection string, doesn't trivially leak credentials to a logged-in user.
//
// Patterns are ordered most-specific → most-generic. Each pattern keeps a
// short prefix so the user/operator can still recognize *what kind* of
// secret was redacted, which is useful when triaging the failure.

/**
 * Used by the two generic `<label>=<value>` patterns at the end of the list.
 * An earlier, more specific pattern may already have turned the value into
 * `sk-ant-***` / `AKIA***`; re-replacing it with a bare `***` would erase the
 * very hint this module promises to keep. Already-redacted values pass through
 * untouched — the secret is gone either way, only the label survives.
 */
function redactUnlessAlreadyRedacted(
  whole: string,
  prefix: string,
  ...groups: (string | undefined)[]
): string {
  const value = groups.find((g) => g !== undefined) ?? '';
  return value.includes('***') ? whole : `${prefix}***`;
}

type Pattern =
  | { rx: RegExp; replace: string }
  | { rx: RegExp; replaceFn: (whole: string, prefix: string, ...g: (string | undefined)[]) => string };

const PATTERNS: Pattern[] = [
  // Anthropic keys: sk-ant-api03-…  /  sk-ant-admin01-…
  { rx: /sk-ant-[A-Za-z0-9_-]+/g, replace: 'sk-ant-***' },
  // OpenAI keys: sk-…  /  sk-proj-…
  { rx: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, replace: 'sk-***' },
  // AWS access key IDs
  { rx: /\bAKIA[0-9A-Z]{16}\b/g, replace: 'AKIA***' },
  // AWS secret access keys (heuristic — 40 base64-ish chars after the
  // canonical query/env-var name)
  {
    rx: /(aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*)["']?[A-Za-z0-9/+=]{40}["']?/gi,
    replace: '$1***',
  },
  // JWT-shaped tokens (header.payload.signature)
  {
    rx: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replace: 'eyJ***',
  },
  // Authorization: Bearer <token>
  { rx: /(Bearer\s+)\S+/gi, replace: '$1***' },
  // password=<value>  /  password: "<value>"  /  password: '<value>'
  {
    rx: /(password\s*[:=]\s*)(?:"([^"]*)"|'([^']*)'|(\S+))/gi,
    replaceFn: redactUnlessAlreadyRedacted,
  },
  // Generic api_key / apikey / api-key / token = <value>
  {
    rx: /((?:api[_-]?key|apikey|token)\s*[:=]\s*)(?:"([^"]*)"|'([^']*)'|(\S+))/gi,
    replaceFn: redactUnlessAlreadyRedacted,
  },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const p of PATTERNS) {
    out =
      'replaceFn' in p
        ? out.replace(p.rx, p.replaceFn as (...args: string[]) => string)
        : out.replace(p.rx, p.replace);
  }
  return out;
}
