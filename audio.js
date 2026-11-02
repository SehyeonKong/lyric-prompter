// 소리 받기: 마이크 / 이 탭 소리(크롬). 받은 소리를 0.1초마다 크로마로 바꿔 넘겨준다.

import { chromaFromDb, HOP } from './features.js';

// 소리를 다듬는 기능은 화음 정보를 망가뜨려서 끈다
const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

export const openMic = () => navigator.mediaDevices.getUserMedia({ audio: RAW });

// 아이패드(데스크톱 사파리로 위장)·아이폰은 탭 소리를 못 받는다
const isAppleTouch = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
export const canCaptureTab = () => !!navigator.mediaDevices?.getDisplayMedia && !isAppleTouch();

export async function openTabAudio() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { ...RAW, suppressLocalAudioPlayback: false },
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    systemAudio: 'include',
  });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (!stream.getAudioTracks().length) throw new Error('no-audio');
  return stream;
}

// ctx는 버튼 클릭 안에서 만들어 넘길 것(아이패드는 그래야 소리가 켜진다)
export function listen(ctx, stream, onFrame) {
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  const mute = ctx.createGain(); // 스피커로는 안 내보내되 처리가 돌게 연결만
  mute.gain.value = 0;
  src.connect(analyser);
  analyser.connect(mute);
  mute.connect(ctx.destination);
  ctx.resume();

  const spec = new Float32Array(analyser.frequencyBinCount);
  const wave = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatFrequencyData(spec);
    analyser.getFloatTimeDomainData(wave);
    let sum = 0;
    for (const x of wave) sum += x * x;
    const db = 10 * Math.log10(sum / wave.length + 1e-12);
    onFrame(chromaFromDb(spec, ctx.sampleRate, analyser.fftSize), db);
  }, HOP * 1000);

  return {
    stop() {
      clearInterval(timer);
      src.disconnect();
      mute.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}
