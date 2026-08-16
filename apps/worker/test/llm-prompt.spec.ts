import { repairJsonString, pickTemplate, TEMPLATE_NOTES } from '../src/ai/llm-provider';

/**
 * The OpenAI-compatible path has no tool-use channel, so the model returns a
 * bare string that has to survive `repairJsonString` before `JSON.parse`.
 * Every case here is a shape a real model has produced at least once.
 */
describe('repairJsonString', () => {
  it('passes clean JSON through unchanged', () => {
    const raw = '{"executiveSummary":"ok"}';
    expect(JSON.parse(repairJsonString(raw))).toEqual({ executiveSummary: 'ok' });
  });

  it('strips ```json fences', () => {
    const raw = '```json\n{"a":1}\n```';
    expect(JSON.parse(repairJsonString(raw))).toEqual({ a: 1 });
  });

  it('strips bare ``` fences', () => {
    expect(JSON.parse(repairJsonString('```\n{"a":1}\n```'))).toEqual({ a: 1 });
  });

  it('drops prose before and after the object', () => {
    const raw = 'นี่คือสรุปครับ:\n{"a":1}\nหวังว่าจะเป็นประโยชน์';
    expect(JSON.parse(repairJsonString(raw))).toEqual({ a: 1 });
  });

  it('removes trailing commas in objects and arrays', () => {
    const raw = '{"items":[1,2,3,],"a":1,}';
    expect(JSON.parse(repairJsonString(raw))).toEqual({ items: [1, 2, 3], a: 1 });
  });

  it('handles trailing commas with newlines between value and brace', () => {
    const raw = '{\n  "a": 1,\n}';
    expect(JSON.parse(repairJsonString(raw))).toEqual({ a: 1 });
  });

  it('keeps Thai text and nested objects intact', () => {
    const raw = '```json\n{"executiveSummary":"ที่ประชุมมีมติอนุมัติ","q":{"n":[1,2,]}}\n```';
    expect(JSON.parse(repairJsonString(raw))).toEqual({
      executiveSummary: 'ที่ประชุมมีมติอนุมัติ',
      q: { n: [1, 2] },
    });
  });

  it('trims surrounding whitespace', () => {
    expect(JSON.parse(repairJsonString('\n\n  {"a":1}  \n'))).toEqual({ a: 1 });
  });

  it('leaves input with no object alone rather than inventing one', () => {
    // Nothing to salvage — the caller is expected to fail on JSON.parse and
    // let BullMQ retry, not to receive a silently fabricated object.
    expect(() => JSON.parse(repairJsonString('I cannot help with that.'))).toThrow();
  });
});

describe('pickTemplate', () => {
  it('routes PLC meetings to the PLC template', () => {
    expect(pickTemplate('PLC')).toBe('plc');
    expect(pickTemplate('plc')).toBe('plc');
  });

  it('falls back to general for every other meeting type', () => {
    for (const t of ['GENERAL', 'PROJECT', 'COMMITTEE', 'TRAINING', '']) {
      expect(pickTemplate(t)).toBe('general');
    }
  });

  it('lets an explicit override win over the meeting type', () => {
    expect(pickTemplate('PLC', 'official')).toBe('official');
    expect(pickTemplate('GENERAL', 'official_school_minutes')).toBe('official');
  });

  it('ignores an unrecognized override instead of failing', () => {
    expect(pickTemplate('PLC', 'nonsense')).toBe('plc');
  });

  it('has prompt notes for every template it can return', () => {
    for (const key of ['general', 'plc', 'official'] as const) {
      expect(TEMPLATE_NOTES[key]).toBeTruthy();
    }
  });
});
