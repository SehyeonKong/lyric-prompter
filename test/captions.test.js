import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson3, parseVtt, parseCaptions } from '../captions.js';

test('json3: 단어별 시간(tOffsetMs)까지 읽고, 빈 줄바꿈 이벤트는 건너뜀', () => {
  const cues = parseJson3({
    events: [
      { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: '이렇게' }, { utf8: ' 쉬운', tOffsetMs: 800 }] },
      { tStartMs: 4000, segs: [{ utf8: '\n' }] },
      { tStartMs: 5000, dDurationMs: 2000, segs: [{ utf8: '마음이야' }] },
    ],
  });
  assert.deepEqual(cues, [
    { time: 1, end: 1.8, text: '이렇게' },
    { time: 1.8, end: 4, text: '쉬운' },
    { time: 5, end: 7, text: '마음이야' },
  ]);
});

test('vtt: 꼬리표 지우고, 굴러가며 반복되는 줄은 새 부분만', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<c>이 밤</c>

00:00:03.000 --> 00:00:05.500
이 밤
<00:00:03.500><c>그날의</c> 반딧불을`;
  assert.deepEqual(parseVtt(vtt), [
    { time: 1, end: 3, text: '이 밤' },
    { time: 3, end: 5.5, text: '그날의 반딧불을' },
  ]);
});

test('srt도 읽고, 형식은 내용으로 알아본다', () => {
  const srt = '1\n00:00:02,500 --> 00:00:04,000\n첫 줄\n\n2\n00:01:00,000 --> 00:01:02,000\n둘째 줄';
  assert.deepEqual(parseCaptions(srt).map((c) => [c.time, c.text]), [[2.5, '첫 줄'], [60, '둘째 줄']]);
  assert.equal(parseCaptions('{"events":[]}').length, 0);
});
