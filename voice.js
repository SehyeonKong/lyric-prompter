// 목소리 따라가기: 음성 인식으로 들어온 글자의 끝부분을 대본과 맞춰 지금 어디까지 불렀는지 찾는다.
// 지금 위치 근처에서만 찾고(후렴 반복 헷갈림 방지), 틀린 글자는 자모가 비슷하면 반쯤 맞은 걸로 본다.
// 인식이 안 맞으면 움직이지 않는다. DOM 없음 → node --test로 검증.

import { chars, charCost } from './align.js';

const DEFAULTS = {
  tail: 14, // 인식된 글의 끝 몇 글자로 찾을지
  minChars: 3, // 이보다 짧으면 너무 흔해서 안 믿음
  back: 20, // 지금 위치 뒤로 찾는 범위(글자)
  fwd: 240, // 앞으로 찾는 범위(글자, 대략 20줄)
  gap: 0.7,
  maxCost: 0.45, // 글자당 평균 틀림 정도가 이보다 크면 안 믿음
  distPenalty: 0.002, // 지금 위치에서 한 글자 멀어질 때마다 깎는 점수
};

export class VoiceTracker {
  constructor(lines, options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.chars = [];
    this.lineStart = lines.map((l, line) => {
      const start = this.chars.length;
      for (const ch of chars(l)) this.chars.push({ ch, line });
      return start;
    });
    this.pos = 0; // 다음에 부를 글자 번호
    this.line = this.chars[0]?.line ?? 0; // 지금 부르는 줄
    this.lastKey = '';
  }

  // 화면에 강조할 줄: 다음에 부를 글자가 있는 줄. 한 줄을 다 부른 게 인식되면(인식은 늦게 오니
  // 그때쯤이면 이미 다음 줄을 부르는 중) 다음 줄로 넘어간다. 대본 끝이면 마지막 줄.
  get focusLine() {
    return this.chars[this.pos]?.line ?? this.chars.at(-1)?.line ?? 0;
  }

  // 사용자가 줄을 눌러 알려준 위치에서 다시
  jumpToLine(i) {
    this.pos = this.lineStart[i] ?? 0;
    this.line = i;
    this.lastKey = '';
  }

  // 지금까지 인식된 글 전체(또는 끝부분). 위치가 바뀌면 true
  hear(transcript) {
    const o = this.o;
    const q = chars(transcript).slice(-o.tail);
    if (q.length < o.minChars) return false;
    const key = q.join('');
    if (key === this.lastKey) return false;
    this.lastKey = key;

    let best = this.match(q, this.pos - o.back, this.pos + o.fwd, 1);
    // 근처에 없고 충분히 길게 들렸으면 대본 전체에서 (멀리 건너뛴 경우)
    if ((!best || best.cost > o.maxCost) && q.length >= 8) {
      const far = this.match(q, 0, this.chars.length, 0.2);
      if (far && far.cost <= o.maxCost * 0.7) best = far;
    }
    if (!best || best.cost > o.maxCost) return false;
    // 뒤로 가는 건 확실할 때만(인식 중간 결과가 고쳐지며 흔들리는 것 막기)
    if (best.end < this.pos && best.cost > o.maxCost / 2) return false;
    if (best.end === this.pos) return false;
    this.pos = best.end;
    this.line = this.chars[best.end - 1].line; // 마지막으로 부른 글자의 줄
    return true;
  }

  // q 전체가 대본 [lo, hi) 어딘가에 들어맞는 가장 싼 자리. cost = 글자당 평균 틀림 + 거리 벌점
  match(q, lo, hi, penaltyScale) {
    const { gap, distPenalty } = this.o;
    lo = Math.max(0, lo);
    hi = Math.min(this.chars.length, hi);
    const w = hi - lo;
    if (w <= 0) return null;
    let prev = new Float32Array(w + 1); // 대본 시작은 어디서든 공짜
    let cur = new Float32Array(w + 1);
    for (let i = 1; i <= q.length; i++) {
      cur[0] = i * gap;
      for (let j = 1; j <= w; j++) {
        cur[j] = Math.min(
          prev[j - 1] + charCost(q[i - 1], this.chars[lo + j - 1].ch),
          prev[j] + gap,
          cur[j - 1] + gap,
        );
      }
      [prev, cur] = [cur, prev];
    }
    let best = null;
    for (let j = 1; j <= w; j++) {
      const end = lo + j;
      const cost = prev[j] / q.length + penaltyScale * distPenalty * Math.abs(end - this.pos);
      if (!best || cost < best.cost) best = { end, cost };
    }
    return best;
  }
}
