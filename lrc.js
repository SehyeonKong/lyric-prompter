// 가사 텍스트 처리: LRC 판별·파싱·현재 줄 찾기·LRC 만들기.
// DOM을 안 써서 node --test로 바로 검증한다.

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const LEADING_TAGS = /^\s*(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g; // 확장 LRC의 단어별 시간
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;
const META_TAG = /^\s*\[[a-z#]+:[^\]]*\]\s*$/i; // [ar:가수] [ti:제목] 같은 정보 줄

function tagToSeconds(min, sec, frac = '') {
  const f = frac ? Number(frac) / 10 ** frac.length : 0;
  return Number(min) * 60 + Number(sec) + f;
}

// 정보 줄을 뺀 나머지 줄의 절반 이상이 시간으로 시작하면 LRC로 본다.
export function isLrc(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !META_TAG.test(l));
  if (lines.length === 0) return false;
  const timed = lines.filter((l) => LEADING_TAGS.test(l)).length;
  return timed / lines.length >= 0.5;
}

// [{ time(초), text }]를 시간순으로. 한 줄에 시간이 여러 개면(후렴 반복) 줄을 복제한다.
// [offset:+500]은 LRC 규칙대로 양수면 가사가 그만큼 빨리 나오게 반영한다.
export function parseLrc(text) {
  let offset = 0;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(OFFSET_TAG);
    if (off) {
      offset = Number(off[1]) / 1000;
      continue;
    }
    const lead = raw.match(LEADING_TAGS);
    if (!lead) continue;
    const words = raw.slice(lead[0].length).replace(WORD_TAG, '').trim();
    for (const m of lead[0].matchAll(TIME_TAG)) {
      lines.push({ time: tagToSeconds(m[1], m[2], m[3]), text: words });
    }
  }
  return lines
    .map((l) => ({ time: Math.max(0, l.time - offset), text: l.text }))
    .sort((a, b) => a.time - b.time);
}

// t초에 불러야 할 줄의 번호. 첫 줄 전이면 -1.
export function lineIndexAt(lines, t) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function formatTime(sec, withFraction = true) {
  const total = Math.round(Math.max(0, sec) * 100);
  const m = String(Math.floor(total / 6000)).padStart(2, '0');
  const s = String(Math.floor(total / 100) % 60).padStart(2, '0');
  if (!withFraction) return `${m}:${s}`;
  return `${m}:${s}.${String(total % 100).padStart(2, '0')}`;
}

export function toLrc(lines) {
  return lines.map((l) => `[${formatTime(l.time)}]${l.text}`).join('\n');
}

// 탭 싱크용: 부를 줄만(빈 줄·정보 줄 제외). LRC면 시간을 떼고 글만.
export function lyricLines(text) {
  const source = isLrc(text)
    ? parseLrc(text).map((l) => l.text)
    : text.split(/\r?\n/).filter((l) => !META_TAG.test(l));
  return source.map((l) => l.trim()).filter(Boolean);
}
