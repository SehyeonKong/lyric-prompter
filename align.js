// 내 가사에 시간 입히기: 시간이 붙은 글(유튜브 자막, 다른 싱크 가사)과 내 가사를 글자 단위로 맞춰
// 내 가사 각 줄이 몇 초에 시작하는지 찾는다.
// 줄 나눔이 달라도 되고, 자동 자막처럼 틀린 글자가 섞여도 한글을 자모로 쪼개 비슷한 소리는 반쯤 맞은 걸로 본다.
// DOM 없음 → node --test로 검증.

const KEEP = /[\p{L}\p{N}]/u;
const NOISE = /\[[^\]]*\]|\([^)]*\)|♪/g; // [음악] (박수) 같은 자막 표시

export const chars = (text) => [...text.replace(NOISE, ' ').toLowerCase()].filter((c) => KEEP.test(c));

function jamo(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  return [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28];
}

// 0 = 같은 글자, 1 = 전혀 다름. 자모가 2개 같으면(마/미, 음/은) 반쯤 맞음
export function charCost(a, b) {
  if (a === b) return 0;
  const x = jamo(a);
  const y = jamo(b);
  if (!x || !y) return 1;
  let same = 0;
  for (let i = 0; i < 3; i++) if (x[i] === y[i]) same++;
  return 1 - (same / 3) * 0.8;
}

const GOOD = 0.5; // 이보다 싸게 짝지어진 글자만 시간 근거로 쓴다

// cues: [{ time, end?, text }] 시간순. 글자마다 시간을 cue 길이 안에서 고르게 나눠 준다.
function sourceChars(cues, maxCue) {
  const out = [];
  cues.forEach((cue, i) => {
    const cs = chars(cue.text);
    if (!cs.length) return;
    const next = cues.slice(i + 1).find((c) => c.time > cue.time)?.time ?? cue.time + maxCue;
    const end = Math.min(cue.end ?? next, next, cue.time + maxCue);
    const dur = Math.max(0.1, end - cue.time);
    cs.forEach((ch, k) => out.push({ ch, t: cue.time + (dur * k) / cs.length }));
  });
  return out;
}

// lines: 내 가사 줄들(빈 줄 없이). 돌려주는 값: [{ time, text, confidence(0~1), guessed }]
export function alignLyrics(lines, cues, { gap = 0.7, maxCue = 8 } = {}) {
  const src = sourceChars(cues, maxCue);
  const tgt = [];
  lines.forEach((l, line) => chars(l).forEach((ch, k) => tgt.push({ ch, line, k })));
  const n = tgt.length;
  const m = src.length;
  if (!n || !m) return lines.map((text) => ({ time: null, text, confidence: 0, guessed: true }));

  // 전역 정렬(자막 앞뒤 남는 부분은 공짜로 건너뜀). back: 0 대각, 1 내 가사 글자 건너뜀, 2 자막 글자 건너뜀
  const W = m + 1;
  const cost = new Float32Array((n + 1) * W);
  const back = new Uint8Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    cost[i * W] = i * gap;
    back[i * W] = 1;
  }
  for (let j = 1; j <= m; j++) back[j] = 2; // 맨 앞 자막은 공짜
  for (let i = 1; i <= n; i++) {
    const a = tgt[i - 1].ch;
    for (let j = 1; j <= m; j++) {
      let best = cost[(i - 1) * W + j - 1] + charCost(a, src[j - 1].ch);
      let dir = 0;
      const up = cost[(i - 1) * W + j] + gap;
      if (up < best) (best = up), (dir = 1);
      const left = cost[i * W + j - 1] + (i === n ? 0 : gap); // 맨 뒤 자막도 공짜
      if (left < best) (best = left), (dir = 2);
      cost[i * W + j] = best;
      back[i * W + j] = dir;
    }
  }

  const timeOf = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const dir = i === 0 ? 2 : j === 0 ? 1 : back[i * W + j];
    if (dir === 0) {
      if (charCost(tgt[i - 1].ch, src[j - 1].ch) <= GOOD) timeOf[i - 1] = src[j - 1].t;
      i--, j--;
    } else if (dir === 1) i--;
    else j--;
  }

  // 줄마다: 잘 맞은 글자들로 줄 첫 글자 시간을 추정
  const result = lines.map((text, line) => {
    const mine = tgt.map((c, idx) => ({ ...c, t: timeOf[idx] })).filter((c) => c.line === line);
    const hits = mine.filter((c) => c.t !== null);
    const confidence = mine.length ? hits.length / mine.length : 0;
    if (confidence < 0.3 || !hits.length) return { time: null, text, confidence, guessed: true };
    const first = hits[0];
    const last = hits.at(-1);
    const perChar = last.k > first.k ? (last.t - first.t) / (last.k - first.k) : 0.3;
    const time = first.t - first.k * Math.min(0.6, Math.max(0.1, perChar));
    return { time, text, confidence, guessed: false };
  });
  return fillGuesses(result);
}

// 못 맞춘 줄은 앞뒤 맞춘 줄 사이를 글자 수 비율로 채우고, 시간이 거꾸로 가지 않게 한다
function fillGuesses(rows) {
  const len = (r) => Math.max(1, chars(r.text).length);
  const anchors = rows.map((r, i) => (r.time !== null ? i : -1)).filter((i) => i >= 0);
  if (!anchors.length) return rows.map((r, i) => ({ ...r, time: i * 3 }));
  const out = rows.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].time !== null) continue;
    const prev = anchors.filter((a) => a < i).at(-1);
    const next = anchors.find((a) => a > i);
    if (prev !== undefined && next !== undefined) {
      const span = out.slice(prev, next).reduce((s, r) => s + len(r), 0);
      const before = out.slice(prev, i).reduce((s, r) => s + len(r), 0);
      out[i].time = out[prev].time + ((out[next].time - out[prev].time) * before) / span;
    } else if (prev !== undefined) {
      out[i].time = out[i - 1].time + len(out[i - 1]) * 0.3;
    } else {
      const ahead = out.slice(i, next).reduce((s, r) => s + len(r), 0);
      out[i].time = Math.max(0, out[next].time - ahead * 0.3);
    }
  }
  for (let i = 1; i < out.length; i++) out[i].time = Math.max(out[i].time, out[i - 1].time + 0.1);
  return out.map((r) => ({ ...r, time: Math.round(r.time * 100) / 100 }));
}
