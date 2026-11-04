import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../../src/domain/model';
import { emptyRecord } from '../../src/domain/model';
import { SAMPLE_RECORD } from '../../src/domain/sample';
import {
  MEMORY_CARD_HEIGHT,
  MEMORY_CARD_WIDTH,
  createRunMemoryPng,
  createRunMemorySvg,
  memoryCardFilename,
  type MemoryCardOptions,
} from '../../src/services/memory-card';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

const svgOf = (record: RunRecord, options?: MemoryCardOptions) => createRunMemorySvg(record, options);

describe('memory card dimensions and structure', () => {
  it('renders a standalone 900x1280 svg document', () => {
    const svg = svgOf(SAMPLE_RECORD);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`width="${MEMORY_CARD_WIDTH}"`);
    expect(svg).toContain(`height="${MEMORY_CARD_HEIGHT}"`);
    expect(MEMORY_CARD_WIDTH).toBe(900);
    expect(MEMORY_CARD_HEIGHT).toBe(1280);
  });

  it('draws real text shapes and never pulls external assets', () => {
    const svg = svgOf(SAMPLE_RECORD, { includeLocation: true });
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    expect(svg).not.toMatch(/href/i);
    expect(svg).not.toMatch(/xlink/i);
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg).toContain('<text');
    expect(svg).toContain('<path');
    expect(svg).toContain('跑步一生');
    expect(svg).toContain('每一次出发，都算数。');
  });
});

describe('fields come straight from the record', () => {
  it('shows the sample distance, duration, pace, heart rate, weather and effort', () => {
    const svg = svgOf(SAMPLE_RECORD);
    expect(svg).toContain('4.36');
    expect(svg).toContain('公里');
    expect(svg).toContain('30:12');
    expect(svg).toContain('6′55″');
    expect(svg).toContain('161');
    expect(svg).toContain('10°C');
    expect(svg).toContain('60%');
    expect(svg).toContain('95');
    expect(svg).toContain('6/10');
    expect(svg).toContain('适中');
    expect(svg).toContain('户外跑步');
    expect(svg).toContain('2026.11.02');
    expect(svg).toContain('20:58');
  });

  it('treats negative and zero temperature as real values', () => {
    expect(svgOf({ ...SAMPLE_RECORD, temperatureCelsius: -3 })).toContain('-3°C');
    expect(svgOf({ ...SAMPLE_RECORD, temperatureCelsius: 0 })).toContain('0°C');
    expect(svgOf({ ...SAMPLE_RECORD, temperatureCelsius: 0 })).not.toContain('-0°C');
  });

  it('shows — for every unknown metric and never invents zero', () => {
    const svg = svgOf(emptyRecord());
    expect(svg).toContain('—');
    expect(svg).not.toContain('0.00');
    expect(svg).not.toContain('0:00');
    expect(svg).toContain('日期未记录');
    expect(svg).toContain('运动类型未记录');
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
    expect(svg).not.toContain(today);
  });

  it('keeps explicit duration authoritative instead of subtracting start and end', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, durationSeconds: 600, startTime: '20:00', endTime: '21:00' });
    expect(svg).toContain('10:00');
    expect(svg).not.toContain('1:00:00');

    const missing = svgOf({ ...SAMPLE_RECORD, durationSeconds: null });
    expect(missing).toContain('—');
    expect(missing).not.toContain('0:31:00');
  });
});

describe('location handling', () => {
  it('omits the location entirely by default', () => {
    const svg = svgOf(SAMPLE_RECORD);
    expect(svg).not.toContain('中国北京市');
    expect(svg).not.toContain('地点');
    expect(svg).not.toMatch(/<title/i);
    expect(svg).not.toMatch(/<metadata/i);
  });

  it('shows the location only when explicitly requested', () => {
    const svg = svgOf(SAMPLE_RECORD, { includeLocation: true });
    expect(svg).toContain('中国北京市');
  });

  it('truncates long unicode locations by codepoint without breaking emoji', () => {
    const location = `${'🏃'.repeat(40)}北京市朝阳区`;
    const svg = svgOf({ ...SAMPLE_RECORD, location }, { includeLocation: true });
    expect(svg).toContain('…');
    expect(hasLoneSurrogate(svg)).toBe(false);
    expect(svg).toContain('🏃');
  });
});

describe('text safety', () => {
  it('escapes xml-significant characters from user text', () => {
    const svg = svgOf(
      {
        ...SAMPLE_RECORD,
        location: `<script>alert("x")&'y'</script>`,
        effortDescription: `5 < 6 & "ok" 'yes' > 3`,
        activityType: 'outdoor_running',
      },
      { includeLocation: true },
    );
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&apos;');
    expect(svg).not.toMatch(/javascript:/i);
  });

  it('strips xml-illegal control characters', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, effortDescription: 'x\u0001\u0008y' });
    expect(svg).not.toContain('\u0001');
    expect(svg).not.toContain('\u0008');
    expect(svg).toContain('xy');
  });
});

describe('30-minute challenge badge', () => {
  it('marks a completed challenge at the exact 1800 second boundary', () => {
    expect(svgOf({ ...SAMPLE_RECORD, durationSeconds: 1800 })).toContain('30分钟挑战已完成');
    expect(svgOf({ ...SAMPLE_RECORD, durationSeconds: 1812 })).toContain('30分钟挑战已完成');
  });

  it('falls back to an ordinary run card below the boundary', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, durationSeconds: 1799 });
    expect(svg).not.toContain('30分钟挑战已完成');
    expect(svg).toContain('普通训练纪念');
  });

  it('never infers the badge from clock times or a missing duration', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, durationSeconds: null, startTime: '20:58', endTime: '21:29' });
    expect(svg).not.toContain('30分钟挑战已完成');
    expect(svg).toContain('普通训练纪念');
  });
});

describe('meaningful decimals are preserved, never rounded away', () => {
  it('keeps a half-point effort as 6.5, not 7', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, effortLevel: 6.5 });
    expect(svg).toContain('强度 6.5/10');
    expect(svg).not.toContain('7/10');
    expect(svg).not.toContain('6.50/10');
  });

  it('still shows a whole effort as a whole number', () => {
    expect(svgOf({ ...SAMPLE_RECORD, effortLevel: 6 })).toContain('强度 6/10');
    expect(svgOf({ ...SAMPLE_RECORD, effortLevel: 6 })).not.toContain('6.0/10');
  });

  it('keeps one decimal for humidity and aqi instead of rounding them', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, humidityPercent: 60.5, airQualityIndex: 95.5 });
    expect(svg).toContain('60.5%');
    expect(svg).toContain('95.5');
    expect(svg).not.toContain('61%');
    expect(svg).not.toContain('96');
  });

  it('keeps a negative half-degree temperature exact and positive zero clean', () => {
    expect(svgOf({ ...SAMPLE_RECORD, temperatureCelsius: -12.5 })).toContain('-12.5°C');
    expect(svgOf({ ...SAMPLE_RECORD, temperatureCelsius: 0 })).toContain('0°C');
    expect(svgOf({ ...SAMPLE_RECORD, temperatureCelsius: 0 })).not.toContain('-0°C');
    expect(svgOf({ ...SAMPLE_RECORD, temperatureCelsius: -0.04 })).not.toContain('-0°C');
  });

  it('never prints an over-long raw decimal', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, temperatureCelsius: 12.3456789, humidityPercent: 60.25, effortLevel: 6.666 });
    expect(svg).toContain('12.3°C');
    expect(svg).toContain('60.3%');
    expect(svg).toContain('6.7/10');
    expect(svg).not.toContain('12.3456789');
  });

  it('leaves heart rate, duration and pace at their established readings', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, averageHeartRateBpm: 161.4, durationSeconds: 1812, averagePaceSecondsPerKm: 415 });
    expect(svg).toContain('161');
    expect(svg).toContain('30:12');
    expect(svg).toContain('6′55″');
  });
});

describe('memory card filename', () => {
  it('builds a safe date and time filename', () => {
    expect(memoryCardFilename(SAMPLE_RECORD)).toBe('跑步一生-2026-11-02-2058.png');
  });

  it('uses a fixed safe fallback for missing or malformed date and time', () => {
    const fallback = memoryCardFilename({ ...SAMPLE_RECORD, date: null, startTime: null });
    expect(fallback).toBe('跑步一生-日期未记录-时间未记录.png');
    expect(memoryCardFilename({ ...SAMPLE_RECORD, date: '2026-13-40', startTime: '25:99' })).toBe(
      '跑步一生-日期未记录-时间未记录.png',
    );
    expect(memoryCardFilename({ ...SAMPLE_RECORD, date: '2026-02-30', startTime: '8:05' })).toBe(
      '跑步一生-日期未记录-时间未记录.png',
    );
  });

  it('never leaks location, id or path characters into the filename', () => {
    const name = memoryCardFilename({ ...SAMPLE_RECORD, id: '../etc/passwd' });
    expect(name).toBe('跑步一生-2026-11-02-2058.png');
    expect(name).not.toContain('中国北京市');
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name).not.toContain('..');
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('pure functions do not mutate their input', () => {
  it('accepts a frozen record and leaves it untouched', () => {
    const record = deepFreeze({ ...SAMPLE_RECORD, awards: [...SAMPLE_RECORD.awards], splits: [...SAMPLE_RECORD.splits] });
    const before = JSON.stringify(record);
    expect(() => createRunMemorySvg(record, { includeLocation: true })).not.toThrow();
    expect(memoryCardFilename(record)).toBe('跑步一生-2026-11-02-2058.png');
    expect(JSON.stringify(record)).toBe(before);
  });
});

interface TextNode { attrs: string; content: string; fill: string | null; size: number | null; }

function textNodes(svg: string): TextNode[] {
  return Array.from(svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)).map(match => {
    const attrs = match[1];
    const content = match[2].replace(/<[^>]+>/g, '');
    const size = /font-size="([\d.]+)"/.exec(attrs);
    const fill = /fill="([^"]+)"/.exec(attrs);
    return { attrs, content, fill: fill ? fill[1] : null, size: size ? Number(size[1]) : null };
  });
}

// Rough advance width in px at the given size: digits are ~0.6em, dots narrower,
// CJK and the 公里 unit are ~1em. Good enough to prove we stay inside the frame.
// The SVG stores escaped entities; for width we measure the visible characters.
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Same conservative model the service uses: digits ~0.72em, dot ~0.45em, and
// every other code point a full em. Budgeting above real bold widths keeps the
// pure test a genuine pre-check for the browser getBBox acceptance.
function estimatedEm(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + (char === '.' ? 0.45 : /[0-9]/.test(char) ? 0.72 : 1), 0);
}

function estimatedWidth(text: string, size: number): number {
  return estimatedEm(text) * size;
}

const HERO_INNER_WIDTH = 720;
const DECORATIVE_LIME = '#A8BE38';

describe('long hero distance stays inside the card', () => {
  it('fits 2000.00 with its unit at full precision without crossing the frame', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, distanceKm: 2000 });
    expect(svg).toContain('2000.00');
    expect(svg).toContain('公里');
    const hero = textNodes(svg).find(node => node.content.startsWith('2000.00'));
    expect(hero).toBeDefined();
    expect(hero!.size).not.toBeNull();
    // Adapts downward but never collapses below the readable floor.
    expect(hero!.size!).toBeLessThan(168);
    expect(hero!.size!).toBeGreaterThanOrEqual(96);
    // The number plus the fixed-width 公里 unit must fit the inner column.
    expect(estimatedWidth('2000.00', hero!.size!) + 72).toBeLessThanOrEqual(HERO_INNER_WIDTH);
  });

  it('keeps the original hero size for the everyday 4.36 distance', () => {
    const hero = textNodes(svgOf(SAMPLE_RECORD)).find(node => node.content.startsWith('4.36'));
    expect(hero!.size).toBe(168);
  });

  it('renders readable numbers in a dark ink, never the pale decorative lime', () => {
    const svg = svgOf(SAMPLE_RECORD);
    const nodes = textNodes(svg);
    const heroValue = nodes.find(node => node.content.startsWith('4.36'));
    const statValue = nodes.find(node => node.content.startsWith('30:12'));
    expect(heroValue!.fill).not.toBe(DECORATIVE_LIME);
    expect(statValue!.fill).not.toBe(DECORATIVE_LIME);
    // The hero number and the stat row share the same readable ink.
    expect(heroValue!.fill).toBe(statValue!.fill);
    // Lime survives as decoration only (top accent band / underline).
    expect(svg).toContain('#DBE6A2');
  });
});

describe('stat units explain the format without touching the source value', () => {
  it('labels pace and heart rate and keeps the big numbers intact', () => {
    const svg = svgOf(SAMPLE_RECORD);
    expect(svg).toContain('/公里');
    expect(svg).toContain('次/分');
    expect(svg).toContain('分:秒');
    expect(svg).toContain('6′55″');
    expect(svg).toContain('161');
    expect(svg).toContain('30:12');
  });

  it('switches the duration unit once an hour is present', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, durationSeconds: 3725 });
    expect(svg).toContain('1:02:05');
    expect(svg).toContain('时:分:秒');
    expect(svg).not.toContain('分:秒时');
  });

  it('puts the unit on a smaller separate line, not inside the big number', () => {
    const nodes = textNodes(svgOf(SAMPLE_RECORD));
    const value = nodes.find(node => node.content === '30:12');
    const unit = nodes.find(node => node.content === '分:秒');
    expect(value!.size).toBe(54);
    expect(unit!.size!).toBeLessThan(value!.size!);
  });

  it('shows no unit when the metric is unknown', () => {
    const svg = svgOf(emptyRecord());
    expect(svg).not.toContain('次/分');
    expect(svg).not.toContain('/公里');
  });
});

describe('long award lists wrap cleanly without overflow or invention', () => {
  const longAwards = ['甲'.repeat(14), '乙'.repeat(14), '丙'.repeat(14)];

  const awardsLinesOf = (svg: string): string[] =>
    textNodes(svg)
      .filter(node => node.content.startsWith('荣誉'))
      .map(node => node.content);

  it('never exceeds two tidy lines and keeps each within the inner column', () => {
    const lines = awardsLinesOf(svgOf({ ...SAMPLE_RECORD, awards: longAwards }));
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(Array.from(line).length * 22).toBeLessThanOrEqual(HERO_INNER_WIDTH);
    }
  });

  it('summarizes the overflow by real count instead of inventing award names', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, awards: longAwards });
    expect(svg).toContain('荣誉 · 共 3 项');
    expect(svg).toContain('甲'.repeat(14));
    // Names that do not fit are dropped, never fabricated.
    expect(svg).not.toContain('乙'.repeat(14));
    expect(svg).not.toContain('丙'.repeat(14));
    const shown = awardsLinesOf(svg).flatMap(line =>
      line.replace(/^荣誉 · /, '').replace(/^共 \d+ 项$/, '').split(' / ').filter(Boolean),
    );
    for (const entry of shown) expect(longAwards).toContain(entry);
  });

  it('keeps two long awards on separate lines without truncating either', () => {
    const awards = [longAwards[0], longAwards[1]];
    const svg = svgOf({ ...SAMPLE_RECORD, awards });
    expect(svg).toContain('甲'.repeat(14));
    expect(svg).toContain('乙'.repeat(14));
    expect(svg).not.toContain('共 2 项');
    expect(awardsLinesOf(svg).length).toBe(2);
  });

  it('leaves a single short award on one line', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, awards: ['首次跑步训练'] });
    expect(awardsLinesOf(svg)).toEqual(['荣誉 · 首次跑步训练']);
  });

  it('keeps unicode awards intact and escaped', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, awards: ['🏅🏅x<&'] });
    expect(hasLoneSurrogate(svg)).toBe(false);
    expect(svg).toContain('&lt;&amp;');
    expect(svg).not.toMatch(/<b>/);
  });
});

describe('award summary reports the real total, not the printed subset', () => {
  const fiveLong = ['甲'.repeat(14), '乙'.repeat(14), '丙'.repeat(14), '丁'.repeat(14), '戊'.repeat(14)];
  const fiveShort = ['首次跑步训练', '连续运动', '早起跑步', '周末长跑', '月度坚持'];

  const awardsLinesOf = (svg: string): string[] =>
    textNodes(svg)
      .filter(node => node.content.startsWith('荣誉'))
      .map(node => node.content);

  it('never claims 共 3 项 when five long awards were recorded', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, awards: fiveLong });
    expect(svg).toContain('荣誉 · 共 5 项');
    expect(svg).not.toContain('共 3 项');
    expect(svg).not.toContain('共 4 项');
  });

  it('shows five names when they fit, and still surfaces that there are five', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, awards: fiveShort });
    const lines = awardsLinesOf(svg);
    expect(lines.length).toBeLessThanOrEqual(2);
    // Every short name is real and printed; nothing is fabricated.
    for (const name of fiveShort) expect(svg).toContain(name);
    expect(svg).not.toMatch(/共 \d+ 项/);
  });

  it('keeps every printed award line inside the inner column for both cases', () => {
    for (const awards of [fiveLong, fiveShort]) {
      const lines = awardsLinesOf(svgOf({ ...SAMPLE_RECORD, awards }));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(Array.from(line).length * 22).toBeLessThanOrEqual(HERO_INNER_WIDTH);
      }
    }
  });
});

describe('long free text is trimmed to the visible area', () => {
  const widthIn = (text: string, size: number) => estimatedWidth(text, size);

  it('trims a long effort description and never overflows the card', () => {
    const description = '节奏稳定'.repeat(15); // 60 CJK chars, storage's limit
    const svg = svgOf({ ...SAMPLE_RECORD, effortDescription: description });
    const node = textNodes(svg).find(entry => entry.content.startsWith('强度 '));
    expect(node).toBeDefined();
    expect(node!.content).toContain('…');
    // Fits from the x=90 origin to the inner right edge at 810.
    expect(90 + widthIn(decodeEntities(node!.content), node!.size ?? 22)).toBeLessThanOrEqual(810);
    expect(node!.content.length).toBeLessThan(description.length + 6);
  });

  it('keeps a short effort description exactly as recorded', () => {
    const node = textNodes(svgOf({ ...SAMPLE_RECORD, effortDescription: '适中' }))
      .find(entry => entry.content.startsWith('强度 '));
    expect(node!.content).toBe('强度 6/10 · 适中');
    expect(node!.content).not.toContain('…');
  });

  it('caps an unrecognized activity type but keeps its words, escaping intact', () => {
    const svg = svgOf({ ...SAMPLE_RECORD, activityType: `越野<&>${'山'.repeat(60)}` });
    const node = textNodes(svg).find(entry => entry.content.includes('·'));
    expect(node).toBeDefined();
    expect(node!.content).toContain('&lt;');
    expect(node!.content).toContain('越野');
    expect(node!.content).toContain('…');
    expect(90 + widthIn(decodeEntities(node!.content), node!.size ?? 24)).toBeLessThanOrEqual(810);
    expect(svg).not.toMatch(/<山/);
  });

  it('leaves the known activity type and 适中 reading untouched', () => {
    const node = textNodes(svgOf(SAMPLE_RECORD)).find(entry => entry.content.includes('·'));
    expect(node!.content).toBe('20:58 · 户外跑步');
  });
});

describe('png conversion surface', () => {
  it('exposes an async png builder that fails with a friendly error without a browser', async () => {
    expect(typeof createRunMemoryPng).toBe('function');
    await expect(createRunMemoryPng(SAMPLE_RECORD)).rejects.toThrow(/纪念卡/);
  });
});
