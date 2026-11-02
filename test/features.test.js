import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromaFromPower, chromaFromDb, centered, fillGaps, encodeFrames, decodeFrames } from '../features.js';

const SR = 48000;
const FFT = 8192;
const spike = (hz, db = false) => {
  const p = new Float32Array(FFT / 2).fill(db ? -Infinity : 0);
  p[Math.round((hz * FFT) / SR)] = db ? -20 : 1;
  return p;
};

test('라(440Hz)는 9번(A) 칸', () => {
  const c = chromaFromPower(spike(440), SR, FFT);
  assert.equal(c.indexOf(Math.max(...c)), 9);
});

test('옥타브가 달라도 같은 음(도 261.6Hz, 523.3Hz → 0번)', () => {
  for (const hz of [261.63, 523.25, 1046.5]) {
    const c = chromaFromPower(spike(hz), SR, FFT);
    assert.equal(c.indexOf(Math.max(...c)), 0, `${hz}Hz`);
  }
});

test('dB 입력도 같은 결과, 무음은 전부 0', () => {
  const c = chromaFromDb(spike(440, true), SR, FFT);
  assert.equal(c.indexOf(Math.max(...c)), 9);
  assert.ok(chromaFromPower(new Float32Array(FFT / 2), SR, FFT).every((v) => v === 0));
});

test('centered: 길이 1, 밋밋하면 null', () => {
  const v = centered(Float32Array.from([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]));
  assert.ok(Math.abs(v.reduce((s, x) => s + x * x, 0) - 1) < 1e-5);
  assert.equal(centered(new Float32Array(12).fill(0.5)), null);
});

test('fillGaps: 짧은 구멍만 채운다', () => {
  const a = Float32Array.of(1);
  const b = Float32Array.of(2);
  assert.deepEqual(fillGaps([a, null, null, b]), [a, a, b, b]);
  assert.deepEqual(fillGaps([a, null, null, null, null, b]), [a, null, null, null, null, b]);
  assert.deepEqual(fillGaps([null, a, null]), [null, a, null]);
});

test('압축 → 복원: 빈 프레임 유지, 값 오차 작음', () => {
  const f = Float32Array.from({ length: 12 }, (_, i) => i / 11);
  const back = decodeFrames(encodeFrames([f, null, f]));
  assert.equal(back.length, 3);
  assert.equal(back[1], null);
  back[0].forEach((v, i) => assert.ok(Math.abs(v - f[i]) < 0.01));
});
