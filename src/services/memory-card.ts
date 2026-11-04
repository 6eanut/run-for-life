import type { RunRecord } from '../domain/model';

export const MEMORY_CARD_WIDTH = 900;
export const MEMORY_CARD_HEIGHT = 1280;

export interface MemoryCardOptions {
  includeLocation?: boolean;
}

// System font stack only. Nothing is requested over the network.
const FONT = "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

const CREAM = '#F7F0DF';
const CREAM_EDGE = '#EDE0C6';
const FOREST = '#22402C';
const HAIRLINE = 'rgba(34,64,44,0.22)';
const LIME = '#A8BE38';
// Deep olive carries the readable numbers; lime stays decoration/underline only.
const OLIVE = '#4E5B22';
const LIME_SOFT = '#DBE6A2';
const CORAL = '#E0714A';
const MUTED = '#6E6A5A';

const UNKNOWN = '—';
const MOTTO = '每一次出发，都算数。';
const BRAND = '跑步一生';

const amount = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

// Drop XML-illegal control characters and lone surrogates, then escape the five
// significant characters. Iterating by code point keeps surrogate pairs intact.
function sanitizeXmlText(input: string): string {
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += char;
      continue;
    }
    if (code < 0x20) continue;
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (code === 0xfffe || code === 0xffff) continue;
    out += char;
  }
  return out;
}

function esc(value: string): string {
  return sanitizeXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Length is counted in code points so an emoji is never sliced in half.
function truncate(value: string, max: number): string {
  const points = Array.from(value);
  if (points.length <= max) return value;
  return `${points.slice(0, Math.max(0, max - 1)).join('')}\u2026`;
}

// Conservative advance-width estimate: digits are narrow, a period narrower,
// every other code point (letters, CJK, emoji, spaces) rounds to a full em.
function estimatedEm(value: string): number {
  return Array.from(value).reduce(
    (sum, char) => sum + (char === '.' ? 0.45 : /[0-9]/.test(char) ? 0.72 : 1),
    0,
  );
}

// Keep `head + tail` inside maxWidth by trimming only `tail` with an ellipsis,
// never splitting a surrogate pair. `head` carries fixed labels and source
// values, so it is left exactly as recorded.
function fitTail(head: string, tail: string, maxWidth: number, fontSize: number): string {
  const fits = (candidate: string) => estimatedEm(`${head}${candidate}`) * fontSize <= maxWidth;
  if (fits(tail)) return tail;
  const points = Array.from(tail);
  while (points.length > 0 && !fits(`${points.join('')}\u2026`)) points.pop();
  return `${points.join('')}\u2026`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// Mirrors the app's duration convention: hours appear only once an hour is met,
// so a 30 min 12 sec run reads 30:12 rather than 0:30:12.
// The unit only spells out the format; it never restates or rounds the value.
function durationUnit(seconds: number | null): string {
  if (seconds === null) return '';
  return Math.floor(Math.max(0, Math.floor(seconds)) / 3600) ? '时:分:秒' : '分:秒';
}

// Widest the hero number plus its 公里 unit may occupy inside the 90..810 column.
const HERO_CONTENT_WIDTH = 720;
// The 公里 unit is a fixed 34px tspan; measured ~68px, reserved a touch wider.
const HERO_UNIT_WIDTH = 72;
// Real bold digits measure ~0.70em; estimate 0.72em so the fit never overruns.
const HERO_DIGIT_EM = 0.72;
const HERO_DOT_EM = 0.45;
const HERO_SAFETY = 14;

// Conservative advance width for the hero number, in em. Every non-digit code
// point is treated as a full digit width, which can only shrink the type.
function heroGlyphEm(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + (char === '.' ? HERO_DOT_EM : HERO_DIGIT_EM), 0);
}

// Shrink the hero number only as far as a long value needs, never below `min`,
// so 2000.00 stays on the card at full precision without crossing the frame.
function heroDistanceFont(value: string, base: number, min: number): number {
  const glyphs = heroGlyphEm(value);
  const budget = HERO_CONTENT_WIDTH - HERO_UNIT_WIDTH - HERO_SAFETY;
  return Math.max(min, Math.min(base, Math.floor(budget / Math.max(glyphs, 0.1))));
}

// Free text sits on one line inside the 90..810 column; these are the sizes the
// activity line and effort line render at, used only to fit their trailing text.
const ACTIVITY_FONT = 24;
const EFFORT_FONT = 22;

const AWARD_LINE_BUDGET = 24;
const AWARD_MAX_LINES = 2;
const AWARD_PREFIX = '荣誉 · ';

// Pack real awards into at most two self-labelled lines. Every line repeats the
// label so a wrapped list still reads clearly; if not everything fits, the last
// line honestly summarizes the remainder by count instead of inventing a name.
function awardsLines(awards: readonly string[], total: number): string[] {
  if (!awards.length) return [];
  const lines: string[] = [];
  let current = '';
  let index = 0;
  for (; index < awards.length; index += 1) {
    const piece = awards[index];
    const candidate = current ? `${current} / ${piece}` : `${AWARD_PREFIX}${piece}`;
    if (!current || Array.from(candidate).length <= AWARD_LINE_BUDGET) {
      current = candidate;
      continue;
    }
    lines.push(current);
    if (lines.length >= AWARD_MAX_LINES) break;
    current = `${AWARD_PREFIX}${piece}`;
  }
  if (index >= awards.length) {
    if (current) lines.push(current);
    return lines.slice(0, AWARD_MAX_LINES);
  }
  // Something did not fit. The summary carries the real total, so a reader never
  // mistakes a shortened list for the whole list.
  lines.length = Math.min(lines.length, AWARD_MAX_LINES - 1);
  lines.push(`${AWARD_PREFIX}共 ${total} 项`);
  return lines;
}

function durationLabel(seconds: number | null): string {
  if (seconds === null) return UNKNOWN;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours ? `${hours}:` : ''}${pad2(minutes)}:${pad2(secs)}`;
}

function paceLabel(value: number | null): string {
  if (value === null) return UNKNOWN;
  let minutes = Math.floor(value / 60);
  let secs = Math.round(value % 60);
  if (secs === 60) {
    minutes += 1;
    secs = 0;
  }
  return `${minutes}\u2032${pad2(secs)}\u2033`;
}

function intLabel(value: number | null): string {
  return value === null ? UNKNOWN : String(Math.round(value));
}

// Mirrors the published trends/report reading: keep one meaningful decimal,
// drop a trailing zero, and never show -0. This also stops an over-long raw
// decimal from squeezing the row. Heart rate, duration and pace are unchanged.
function decimalLabel(value: number | null): string {
  if (value === null) return UNKNOWN;
  const rounded = Number(value.toFixed(1));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function activityLabel(value: string | null): string {
  const raw = text(value);
  if (!raw) return '运动类型未记录';
  if (raw === 'outdoor_running') return '户外跑步';
  if (raw === 'indoor_running') return '室内跑步';
  if (raw === 'running') return '跑步';
  // Free-form fallback: keep the author's words exactly; the render line fits them.
  return raw;
}

function dateLabel(value: string | null): string {
  const raw = text(value);
  return raw ? raw.replaceAll('-', '.') : '日期未记录';
}

// Abstract lemniscate built from fixed cubic segments. Pure decoration: it never
// claims to be a GPS route.
function infinityPath(cx: number, cy: number, width: number, rise: number): string {
  const half = width / 2;
  return [
    `M ${cx} ${cy}`,
    `C ${cx + half} ${cy - rise} ${cx + width} ${cy - rise} ${cx + width} ${cy}`,
    `C ${cx + width} ${cy + rise} ${cx + half} ${cy + rise} ${cx} ${cy}`,
    `C ${cx - half} ${cy + rise} ${cx - width} ${cy + rise} ${cx - width} ${cy}`,
    `C ${cx - width} ${cy - rise} ${cx - half} ${cy - rise} ${cx} ${cy}`,
    'Z',
  ].join(' ');
}

interface Stat {
  label: string;
  value: string;
  unit: string;
}

function statText(stat: Stat, x: number): string[] {
  const lines = [
    `<text x="${x}" y="762" font-family="${FONT}" font-size="21" letter-spacing="2" fill="${MUTED}">${esc(stat.label)}</text>`,
    `<text x="${x}" y="828" font-family="${FONT}" font-size="54" font-weight="700" fill="${OLIVE}">${esc(stat.value)}</text>`,
  ];
  if (stat.unit) {
    lines.push(
      `<text x="${x}" y="862" font-family="${FONT}" font-size="20" letter-spacing="1" fill="${MUTED}">${esc(stat.unit)}</text>`,
    );
  }
  return lines;
}

function weatherText(label: string, value: string, x: number): string[] {
  return [
    `<text x="${x}" y="946" font-family="${FONT}" font-size="20" letter-spacing="2" fill="${MUTED}">${esc(label)}</text>`,
    `<text x="${x}" y="988" font-family="${FONT}" font-size="34" font-weight="600" fill="${FOREST}">${esc(value)}</text>`,
  ];
}

export function createRunMemorySvg(record: RunRecord, options: MemoryCardOptions = {}): string {
  const includeLocation = options.includeLocation === true;

  const distance = amount(record.distanceKm);
  const duration = amount(record.durationSeconds);
  const pace = amount(record.averagePaceSecondsPerKm);
  const heartRate = amount(record.averageHeartRateBpm);
  const temperature = amount(record.temperatureCelsius);
  const humidity = amount(record.humidityPercent);
  const airQuality = amount(record.airQualityIndex);
  const effortLevel = amount(record.effortLevel);
  const effortDescription = text(record.effortDescription);
  const location = includeLocation ? text(record.location) : null;
  // Real non-blank awards drive the count; the printed list is a bounded view of
  // them, so a summary can always report the true total.
  const awardNames = Array.isArray(record.awards)
    ? record.awards.flatMap(award => (text(award) ? [text(award)!] : []))
    : [];
  const awards = awardNames.map(name => truncate(name, 14));

  const distanceValue = distance === null ? UNKNOWN : distance.toFixed(2);
  const startTime = text(record.startTime) ?? '时间未记录';
  const activity = activityLabel(record.activityType);
  const activityPrefix = `${startTime} · `;
  const activityLine = `${activityPrefix}${fitTail(activityPrefix, activity, HERO_CONTENT_WIDTH, ACTIVITY_FONT)}`;

  const challengeDone = duration !== null && duration >= 1800;
  const challengeText = challengeDone ? '30分钟挑战已完成' : '普通训练纪念';
  const challengeAccent = challengeDone ? CORAL : FOREST;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MEMORY_CARD_WIDTH}" height="${MEMORY_CARD_HEIGHT}" viewBox="0 0 ${MEMORY_CARD_WIDTH} ${MEMORY_CARD_HEIGHT}" role="img">`,
  );

  parts.push(`<rect x="0" y="0" width="${MEMORY_CARD_WIDTH}" height="${MEMORY_CARD_HEIGHT}" fill="${CREAM}"/>`);
  parts.push(`<rect x="0" y="0" width="${MEMORY_CARD_WIDTH}" height="14" fill="${LIME_SOFT}"/>`);
  parts.push(`<rect x="40" y="40" width="820" height="1200" rx="30" fill="none" stroke="${FOREST}" stroke-width="2"/>`);
  parts.push(`<rect x="54" y="54" width="792" height="1172" rx="20" fill="none" stroke="${HAIRLINE}" stroke-width="1"/>`);

  // Faint watermark.
  parts.push(
    `<path d="${infinityPath(450, 1130, 240, 92)}" fill="none" stroke="${CREAM_EDGE}" stroke-width="26"/>`,
  );

  // Brand row.
  parts.push(
    `<path d="${infinityPath(104, 128, 22, 9)}" fill="none" stroke="${LIME}" stroke-width="4"/>`,
  );
  parts.push(
    `<text x="140" y="142" font-family="${FONT}" font-size="38" font-weight="700" letter-spacing="6" fill="${FOREST}">${esc(BRAND)}</text>`,
  );
  parts.push(
    `<text x="810" y="136" text-anchor="end" font-family="${FONT}" font-size="15" letter-spacing="3" fill="${CORAL}">RUN MEMORY CARD</text>`,
  );
  parts.push(`<line x1="90" y1="178" x2="810" y2="178" stroke="${HAIRLINE}" stroke-width="1"/>`);

  // Identity block.
  parts.push(
    `<text x="90" y="248" font-family="${FONT}" font-size="40" font-weight="700" letter-spacing="1" fill="${FOREST}">${esc(dateLabel(record.date))}</text>`,
  );
  parts.push(
    `<text x="90" y="294" font-family="${FONT}" font-size="24" fill="${MUTED}">${esc(activityLine)}</text>`,
  );

  // Challenge badge (top right).
  parts.push(`<rect x="590" y="218" width="220" height="46" rx="23" fill="none" stroke="${challengeAccent}" stroke-width="1.5"/>`);
  parts.push(
    `<text x="700" y="247" text-anchor="middle" font-family="${FONT}" font-size="20" letter-spacing="1" fill="${challengeAccent}">${esc(challengeText)}</text>`,
  );

  // Hero distance.
  parts.push(
    `<text x="90" y="424" font-family="${FONT}" font-size="22" letter-spacing="4" fill="${MUTED}">运动距离</text>`,
  );
  const distanceFont = heroDistanceFont(distanceValue, 168, 96);
  const distanceUnit = distance === null ? '' : `<tspan font-size="34" font-weight="600" fill="${MUTED}"> 公里</tspan>`;
  parts.push(
    `<text x="90" y="588" font-family="${FONT}" font-size="${distanceFont}" font-weight="700" fill="${OLIVE}">${esc(distanceValue)}${distanceUnit}</text>`,
  );
  parts.push(`<rect x="92" y="612" width="${distance === null ? 60 : 300}" height="6" rx="3" fill="${LIME_SOFT}"/>`);
  if (location) {
    parts.push(
      `<text x="90" y="666" font-family="${FONT}" font-size="22" fill="${MUTED}">${esc(`地点 · ${truncate(location, 26)}`)}</text>`,
    );
  }

  // Four hero stats: distance is the hero above, the other three sit in a row.
  const stats: Stat[] = [
    { label: '运动时长', value: durationLabel(duration), unit: durationUnit(duration) },
    { label: '平均配速', value: paceLabel(pace), unit: pace === null ? '' : '/公里' },
    { label: '平均心率', value: intLabel(heartRate), unit: heartRate === null ? '' : '次/分' },
  ];
  parts.push(`<line x1="90" y1="718" x2="810" y2="718" stroke="${HAIRLINE}" stroke-width="1"/>`);
  stats.forEach((stat, index) => parts.push(...statText(stat, 90 + index * 300)));

  // Weather strip.
  parts.push(`<line x1="90" y1="900" x2="810" y2="900" stroke="${HAIRLINE}" stroke-width="1"/>`);
  parts.push(...weatherText('气温', temperature === null ? UNKNOWN : `${decimalLabel(temperature)}°C`, 90));
  parts.push(...weatherText('湿度', humidity === null ? UNKNOWN : `${decimalLabel(humidity)}%`, 370));
  parts.push(...weatherText('空气质量指数', decimalLabel(airQuality), 650));

  // Effort + awards, only when there is something real to show.
  const auxiliary: string[] = [];
  if (effortLevel !== null || effortDescription) {
    const level = effortLevel === null ? null : `${decimalLabel(effortLevel)}/10`;
    const prefix = level ? `强度 ${level}` : '强度';
    const combined = effortDescription
      ? `${prefix} · ${fitTail(`${prefix} · `, effortDescription, HERO_CONTENT_WIDTH, EFFORT_FONT)}`
      : prefix;
    auxiliary.push(
      `<text x="90" y="1046" font-family="${FONT}" font-size="22" fill="${FOREST}">${esc(combined)}</text>`,
    );
  }
  if (awards.length) {
    awardsLines(awards, awardNames.length).forEach((line, index) => {
      auxiliary.push(
        `<text x="90" y="${1084 + index * 30}" font-family="${FONT}" font-size="22" fill="${CORAL}">${esc(line)}</text>`,
      );
    });
  }
  parts.push(...auxiliary);

  // Footer.
  parts.push(`<line x1="90" y1="1150" x2="810" y2="1150" stroke="${HAIRLINE}" stroke-width="1"/>`);
  parts.push(
    `<text x="450" y="1216" text-anchor="middle" font-family="${FONT}" font-size="26" letter-spacing="3" fill="${FOREST}">${esc(MOTTO)}</text>`,
  );
  parts.push(`<rect x="430" y="1236" width="40" height="4" rx="2" fill="${CORAL}"/>`);

  parts.push('</svg>');
  return parts.join('\n');
}

function svgToBlobUrl(svg: string): string {
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
}

export async function createRunMemoryPng(record: RunRecord, options: MemoryCardOptions = {}): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('当前浏览器无法生成纪念卡');
  }
  const svg = createRunMemorySvg(record, options);
  const url = svgToBlobUrl(svg);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('纪念卡图片加载失败'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    // The card is delivered at its design size; no extra device-pixel scaling.
    canvas.width = MEMORY_CARD_WIDTH;
    canvas.height = MEMORY_CARD_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法绘制纪念卡');
    context.drawImage(image, 0, 0, MEMORY_CARD_WIDTH, MEMORY_CARD_HEIGHT);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('纪念卡导出失败，请重试');
    return blob;
  } catch (error) {
    if (error instanceof Error && /纪念卡/.test(error.message)) throw error;
    throw new Error('纪念卡导出失败，请重试');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Only a strictly valid ISO date and HH:mm are trusted; anything else falls back
// to fixed literal text so no user value or path character reaches the filename.
function safeDatePart(value: string | null): string {
  const raw = text(value);
  const match = raw ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
  if (!match) return '日期未记录';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '日期未记录';
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return '日期未记录';
  }
  return raw!;
}

function safeTimePart(value: string | null): string {
  const raw = text(value);
  const match = raw ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw) : null;
  return match ? `${match[1]}${match[2]}` : '时间未记录';
}

export function memoryCardFilename(record: RunRecord): string {
  return `${BRAND}-${safeDatePart(record.date)}-${safeTimePart(record.startTime)}.png`;
}
