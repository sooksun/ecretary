import { redactSecrets } from '../src/redactSecrets';

/**
 * `redactSecrets` is the last thing standing between a provider SDK error and
 * `Meeting.failureReason`, which the mobile app shows verbatim to any logged-in
 * user of the org. A regression here leaks credentials to end users, so each
 * pattern gets an explicit case.
 */
describe('redactSecrets', () => {
  it('redacts Anthropic keys but keeps the prefix recognizable', () => {
    const out = redactSecrets('401 invalid x-api-key: sk-ant-api03-AbC123_def-XYZ456');
    expect(out).toContain('sk-ant-***');
    expect(out).not.toContain('AbC123_def-XYZ456');
  });

  it('redacts OpenAI project keys', () => {
    const key = `sk-proj-${'a1B2c3D4e5'.repeat(4)}`;
    const out = redactSecrets(`openai 401: ${key}`);
    expect(out).not.toContain(key);
    expect(out).toContain('sk-***');
  });

  it('redacts AWS access key ids', () => {
    const out = redactSecrets('S3 denied for AKIAIOSFODNN7EXAMPLE on bucket msecretary');
    expect(out).toContain('AKIA***');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    // Non-secret context survives so the operator can still triage.
    expect(out).toContain('bucket msecretary');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.s1gn4tur3_v4lu3';
    const out = redactSecrets(`auth failed for ${jwt}`);
    expect(out).toContain('eyJ***');
    expect(out).not.toContain('s1gn4tur3_v4lu3');
  });

  it('redacts Bearer tokens in dumped headers', () => {
    const out = redactSecrets('headers: { Authorization: Bearer abc.def.ghi }');
    expect(out).toContain('Bearer ***');
    expect(out).not.toContain('abc.def.ghi');
  });

  it('redacts passwords in connection strings and key=value pairs', () => {
    expect(redactSecrets('password=hunter2 host=db')).not.toContain('hunter2');
    expect(redactSecrets('password: "p@ss w0rd"')).not.toContain('p@ss w0rd');
    expect(redactSecrets("password: 'quoted'")).not.toContain('quoted');
  });

  it('redacts generic api_key / apikey / token assignments', () => {
    for (const name of ['api_key', 'api-key', 'apikey', 'token']) {
      const out = redactSecrets(`${name}=SUPERSECRETVALUE`);
      expect(out).not.toContain('SUPERSECRETVALUE');
      expect(out).toContain('***');
    }
  });

  it('leaves ordinary error text untouched', () => {
    const msg = 'whisper service 503: upstream unavailable after 3 attempts';
    expect(redactSecrets(msg)).toBe(msg);
  });

  it('redacts every secret when several appear in one message', () => {
    const out = redactSecrets(
      'sk-ant-api03-KEY1 then AKIAIOSFODNN7EXAMPLE then password=pw1',
    );
    expect(out).not.toContain('KEY1');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).not.toContain('pw1');
  });

  it('is safe on empty input', () => {
    expect(redactSecrets('')).toBe('');
  });
});
