// 소리 → 크로마(도~시 12음별 세기) 변환과 저장용 압축.
// 크로마는 화음 흐름을 나타내서, 빠르기·음색·편곡이 달라도 같은 곡이면 비슷하게 나온다.
// DOM 없음 → node --test로 검증.

export const HOP = 0.1; // 프레임 간격(초)
const MIN_HZ = 100;
const MAX_HZ = 4000;

const binMaps = new Map();
function binMap(sampleRate, fftSize) {
  const key = `${sampleRate}/${fftSize}`;
  let map = binMaps.get(key);
  if (!map) {
    map = new Int8Array(fftSize / 2).fill(-1);
    for (let k = 1; k < map.length; k++) {
      const hz = (k * sampleRate) / fftSize;
      if (hz < MIN_HZ || hz > MAX_HZ) continue;
      map[k] = (((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12);
    }
    binMaps.set(key, map);
  }
  return map;
}

// power: 선형 파워 스펙트럼(fftSize/2칸). 소리 크기와 상관없게 최댓값으로 나누고 로그로 눌러준다.
export function chromaFromPower(power, sampleRate, fftSize) {
  const map = binMap(sampleRate, fftSize);
  const c = new Float32Array(12);
  for (let k = 0; k < map.length; k++) if (map[k] >= 0) c[map[k]] += power[k];
  const max = Math.max(...c);
  if (!(max > 0)) return c;
  for (let i = 0; i < 12; i++) c[i] = Math.log1p((100 * c[i]) / max) / Math.log1p(100);
  return c;
}

// AnalyserNode.getFloatFrequencyData(dB)용
export function chromaFromDb(db, sampleRate, fftSize) {
  const power = new Float32Array(db.length);
  for (let k = 0; k < db.length; k++) power[k] = Number.isFinite(db[k]) ? 10 ** (db[k] / 10) : 0;
  return chromaFromPower(power, sampleRate, fftSize);
}

// 비교용: 평균을 빼고 길이 1로. 두 프레임의 내적이 -1~1 유사도가 된다. 밋밋하면 null.
export function centered(c) {
  let mean = 0;
  for (let i = 0; i < 12; i++) mean += c[i] / 12;
  const v = new Float32Array(12);
  let norm = 0;
  for (let i = 0; i < 12; i++) {
    v[i] = c[i] - mean;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-3) return null;
  for (let i = 0; i < 12; i++) v[i] /= norm;
  return v;
}

// 비어 있는 프레임이 짧게(maxGap개 이하) 끼어 있으면 가까운 프레임으로 채운다.
export function fillGaps(frames, maxGap = 3) {
  const out = frames.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && !out[j]) j++;
    if (i > 0 && j < out.length && j - i <= maxGap) {
      for (let k = i; k < j; k++) out[k] = k - (i - 1) <= j - k ? out[i - 1] : out[j];
    }
    i = j;
  }
  return out;
}

// 프레임당 12바이트(1~255, 빈 프레임은 0)로 압축해 base64로. 4분 곡 ≈ 38KB.
export function encodeFrames(frames) {
  const bytes = new Uint8Array(frames.length * 12);
  frames.forEach((f, n) => {
    if (!f) return;
    const max = Math.max(...f) || 1;
    for (let i = 0; i < 12; i++) bytes[n * 12 + i] = 1 + Math.round((Math.max(0, f[i]) / max) * 254);
  });
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeFrames(b64) {
  const s = atob(b64);
  const frames = [];
  for (let n = 0; n < s.length / 12; n++) {
    const f = new Float32Array(12);
    let any = false;
    for (let i = 0; i < 12; i++) {
      const b = s.charCodeAt(n * 12 + i);
      if (b) any = true;
      f[i] = b ? (b - 1) / 254 : 0;
    }
    frames.push(any ? f : null);
  }
  return frames;
}
