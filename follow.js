// 음악 따라가기: 마이크로 들은 크로마를 기억해 둔 곡(ref)과 비교해 지금 곡의 몇 초인지 추적한다.
// 0.5초마다 "최근 몇 초가 ref의 어느 위치·어느 빠르기와 가장 닮았나"를 예상 위치 근처에서 찾고,
// 확신이 없으면 하던 빠르기대로 진행, 오래 놓치면 곡 전체에서 다시 찾는다.
// 시간(t)은 밖에서 넣어 주므로 DOM 없이 테스트할 수 있다.

import { centered } from './features.js';

const DEFAULTS = {
  hop: 0.1,
  window: 5, // 비교에 쓰는 최근 구간(초)
  every: 0.5, // 위치 갱신 간격(초)
  back: 16, // 예상 위치 뒤·앞으로 찾는 범위(초). 뒤가 넓은 건 밴드가 구간을 반복할 때 돌아가려고
  fwd: 10,
  rates: Array.from({ length: 13 }, (_, i) => 0.85 + i * 0.025), // 원곡 대비 밴드 빠르기 후보(85~115%)
  minDb: -60, // 이보다 작은 소리는 조용한 것으로 (시작 직후 주변 소음을 재서 다시 정함)
  calibrate: 0.5, // 주변 소음 재는 시간(초)
  minScore: 0.35, // 이보다 덜 닮으면 믿지 않음
  minMargin: 0.02, // 2초 넘게 떨어진 다른 후보보다 이만큼은 나아야 믿음
  distPenalty: 0.015, // 예상 위치에서 1초 멀어질 때마다 깎는 점수
  ratePenalty: 0.3,
  lostAfter: 4, // 이만큼 못 맞추면 곡 전체에서 다시 찾기
};

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += a[i] * b[i];
  return s;
};

export class Follower {
  constructor(refFrames, options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.ref = refFrames.map((f) => (f ? centered(f) : null));
    this.duration = this.ref.length * this.o.hop;
    this.live = [];
    this.reset(0, 0);
  }

  // 처음부터(또는 pos초부터) 새로 듣기
  reset(pos, t) {
    this.live = [];
    this.jump(pos, t);
    this.rate = 1;
    this.state = 'listening';
    this.lastUpdate = t;
    this.ambient = [];
    this.calibrateUntil = t + this.o.calibrate;
  }

  // 사용자가 줄을 눌러 위치를 알려줬을 때: 들은 소리는 그대로 두고 위치만 옮김
  jump(pos, t) {
    this.pos = pos;
    this.t = t;
    this.state = 'following';
    this.lostSince = null;
    this.lastGlobal = -Infinity;
  }

  position(t) {
    const p = this.state === 'quiet' ? this.pos : this.pos + (t - this.t) * this.rate;
    return Math.min(this.duration, Math.max(0, p));
  }

  push(chroma, db, t) {
    if (this.ambient && t < this.calibrateUntil) {
      this.ambient.push(db);
    } else if (this.ambient) {
      // 주변 소음보다 10dB 큰 소리부터 '들린다'로. 연주 중에 시작해도 막히지 않게 -30dB 넘게는 안 올림
      const mean = this.ambient.reduce((a, b) => a + b, 0) / (this.ambient.length || 1);
      this.o.minDb = Math.min(-30, Math.max(-60, mean + 10));
      this.ambient = null;
    }
    this.live.push({ t, v: db >= this.o.minDb ? centered(chroma) : null });
    while (this.live.length && this.live[0].t < t - this.o.window) this.live.shift();
    if (t - this.lastUpdate >= this.o.every) {
      this.lastUpdate = t;
      this.update(t);
    }
  }

  update(t) {
    const o = this.o;
    const pred = this.position(t);
    const frames = this.live.filter((f) => f.v);
    if (frames.length < (o.window / o.hop) * 0.4) {
      // 조용함(곡 시작 전, 브레이크): 그 자리에서 기다린다
      this.pos = pred;
      this.t = t;
      this.state = 'quiet';
      return;
    }
    const near = this.search(t, pred - o.back, pred + o.fwd, frames, pred, 1);
    if (near.raw >= o.minScore && near.margin >= o.minMargin) return this.accept(near, pred, t);

    this.pos = pred;
    this.t = t;
    if (this.state !== 'lost') this.state = 'coasting';
    this.lostSince ??= t;
    if (t - this.lostSince >= o.lostAfter && t - this.lastGlobal >= 2) {
      this.lastGlobal = t;
      const all = this.search(t, 0, this.duration, frames, pred, 0.2);
      if (all.raw >= o.minScore + 0.1 && all.margin >= o.minMargin) this.accept(all, pred, t);
      else this.state = 'lost';
    }
  }

  accept(best, pred, t) {
    const jump = best.pos - pred;
    this.pos = Math.abs(jump) < 1 ? pred + jump * 0.5 : best.pos; // 작은 차이는 부드럽게
    this.rate += (best.rate - this.rate) * 0.3;
    this.t = t;
    this.state = 'following';
    this.lostSince = null;
  }

  // from~to초 사이에서, 최근 소리가 "c초에 끝나고 빠르기 r"이라는 가정과 가장 맞는 (c, r)
  search(t, from, to, frames, pred, penaltyScale) {
    const o = this.o;
    const j0 = Math.max(0, Math.round(from / o.hop));
    const j1 = Math.min(this.ref.length - 1, Math.round(to / o.hop));
    const scored = [];
    let best = { score: -Infinity, raw: -Infinity, margin: 0 };
    for (let j = j0; j <= j1; j++) {
      const c = j * o.hop;
      let raw = -Infinity;
      let rate = 1;
      for (const r of o.rates) {
        let s = 0;
        let n = 0;
        for (const f of frames) {
          const R = this.ref[Math.round((c - (t - f.t) * r) / o.hop)];
          if (!R) continue;
          s += dot(f.v, R);
          n++;
        }
        if (n < frames.length * 0.6) continue;
        const score = s / n - o.ratePenalty * Math.abs(r - this.rate);
        if (score > raw) {
          raw = score;
          rate = r;
        }
      }
      if (raw === -Infinity) continue;
      const score = raw - penaltyScale * o.distPenalty * Math.abs(c - pred);
      scored.push([c, score]);
      if (score > best.score) best = { pos: c, rate, score, raw };
    }
    let second = -Infinity;
    for (const [c, score] of scored) if (Math.abs(c - best.pos) > 2 && score > second) second = score;
    best.margin = best.score - second;
    return best;
  }
}
