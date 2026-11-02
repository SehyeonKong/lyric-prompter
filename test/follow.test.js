// 가짜 밴드 곡으로 따라가기 검증: 원곡보다 3% 빠르고 ±5% 출렁이며, 솔로를 4마디 더 하고, 잡음이 큰 상황.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Follower } from '../follow.js';

const CHORDS = { C: [0, 4, 7], G: [7, 11, 2], Am: [9, 0, 4], F: [5, 9, 0], Em: [4, 7, 11], Dm: [2, 5, 9] };
const VERSE = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'];
const CHORUS = ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'];
const SOLO = ['Dm', 'G', 'C', 'Am', 'Dm', 'G', 'Em', 'Am'];
const SONG = [
  ...['C', 'G', 'Am', 'F'].map((c) => [c, false]),
  ...VERSE.map((c) => [c, true]),
  ...CHORUS.map((c) => [c, true]),
  ...VERSE.map((c) => [c, true]),
  ...CHORUS.map((c) => [c, true]),
  ...SOLO.map((c) => [c, false]),
  ...CHORUS.map((c) => [c, true]),
  ...['F', 'G', 'C', 'C'].map((c) => [c, false]),
];
const BAR = 2; // 120BPM 4/4
const SONG_LEN = SONG.length * BAR;
const SOLO_END = (4 + 8 * 4 + 8) * BAR;
const HOP = 0.1;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 곡의 s초 소리를 크로마로: 화음 + 배음 + 멜로디 + 잡음(드럼·방 소리)
function frameAt(s, rand, noise) {
  const c = new Float32Array(12);
  const tones = CHORDS[SONG[Math.min(SONG.length - 1, Math.floor(s / BAR))][0]];
  tones.forEach((p, i) => {
    c[p] += i === 0 ? 1 : 0.8;
    c[(p + 7) % 12] += 0.25;
  });
  c[(tones[Math.floor(s * 2) % 3] + (Math.floor(s) % 4 === 3 ? 2 : 0)) % 12] += 0.7;
  for (let i = 0; i < 12; i++) c[i] += rand() * noise;
  return c;
}

const REF = Array.from({ length: SONG_LEN / HOP }, (_, j) => frameAt(j * HOP, rng(1), 0.3));

function perform({ startDelay = 2, base = 1.03, wobble = 0.05, extendSolo = true, pressAt = 0, tapAt = null, noise = 0.8 }) {
  const f = new Follower(REF);
  const rand = rng(7);
  let s = -startDelay;
  let repeated = false;
  let repeatAt = Infinity;
  const log = [];
  for (let t = 0; s < SONG_LEN - 1; t += HOP) {
    if (t >= pressAt) {
      if (log.length === 0) f.reset(0, t);
      const playing = s >= 0;
      if (tapAt !== null && Math.abs(t - tapAt) < HOP / 2) f.jump(s, t); // 사용자가 지금 줄을 누름
      f.push(playing ? frameAt(s, rand, noise) : new Float32Array(12), playing ? -20 : -90, t);
      log.push({ t, s, est: f.position(t), state: f.state });
    }
    s += HOP * (s < 0 ? 1 : base + wobble * Math.sin((2 * Math.PI * t) / 50));
    if (extendSolo && !repeated && s >= SOLO_END) {
      s -= 4 * BAR; // 솔로 뒤 4마디 한 번 더
      repeated = true;
      repeatAt = t;
    }
  }
  return { log, repeatAt };
}

const lyricAt = (s) => s >= 0 && SONG[Math.floor(s / BAR)]?.[1];

function report(log, skip) {
  const errs = log.filter((r) => lyricAt(r.s) && !skip(r)).map((r) => Math.abs(r.est - r.s));
  errs.sort((a, b) => a - b);
  return { n: errs.length, within1: errs.filter((e) => e <= 1).length / errs.length, p50: errs[errs.length >> 1] };
}

test('3% 빠름 + ±5% 출렁 + 솔로 연장 + 큰 잡음: 가사 구간 90% 이상이 1초 안', () => {
  const { log, repeatAt } = perform({});
  const r = report(log, (x) => x.t < 8 || (x.t >= repeatAt && x.t < repeatAt + 10));
  console.log('  ', r);
  assert.ok(r.within1 >= 0.9, JSON.stringify(r));
});

test('시간만으로 갔다면(비교용) 같은 조건에서 많이 틀린다', () => {
  const { log } = perform({});
  const errs = log.filter((x) => lyricAt(x.s)).map((x) => Math.abs(x.t - 2 - x.s));
  const within1 = errs.filter((e) => e <= 1).length / errs.length;
  console.log('   시간만:', within1.toFixed(2));
  assert.ok(within1 < 0.5);
});

test('곡 시작 전 조용하면 0초에서 기다린다', () => {
  const { log } = perform({ startDelay: 6 });
  const before = log.filter((x) => x.t > 3 && x.t < 5.5);
  assert.ok(before.every((x) => x.est < 1), JSON.stringify(before.map((x) => x.est.toFixed(1))));
});

test('늦게 시작 눌러도 줄을 한 번 눌러 주면 그다음부터 따라간다', () => {
  // 1절·2절처럼 화음이 같은 구간은 소리만으로 구분이 안 돼서, 위치는 사람이 한 번 알려줘야 한다
  const { log } = perform({ pressAt: 22, tapAt: 30, extendSolo: false });
  const later = log.filter((x) => x.t > 31 && lyricAt(x.s));
  const ok = later.filter((x) => Math.abs(x.est - x.s) <= 1).length / later.length;
  console.log('   늦게 시작 + 한 번 탭:', ok.toFixed(2));
  assert.ok(ok >= 0.9);
});

test('시작 직후 주변 소음을 재서 조용함 기준을 정한다', () => {
  const quietRoom = new Follower(REF);
  const loudRoom = new Follower(REF);
  quietRoom.reset(0, 0);
  loudRoom.reset(0, 0);
  for (let t = 0; t <= 0.7; t += HOP) {
    quietRoom.push(new Float32Array(12), -52, t);
    loudRoom.push(new Float32Array(12), -15, t);
  }
  assert.equal(quietRoom.o.minDb, -42);
  assert.equal(loudRoom.o.minDb, -30);
  assert.equal(new Follower(REF).o.minDb, -60); // 다른 인스턴스에 안 번짐
});
