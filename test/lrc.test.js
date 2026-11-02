import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLrc, parseLrc, lineIndexAt, formatTime, toLrc, lyricLines } from '../lrc.js';

const SAMPLE = `[ti:테스트]
[ar:누군가]
[00:12.00]첫 줄
[00:15.5]둘째 줄
[00:20.123][01:10.00]후렴
[00:30.00]`;

test('일반 가사는 LRC가 아니다', () => {
  assert.equal(isLrc('그대 내 품에\n안겨 눈을 감아요'), false);
  assert.equal(isLrc(''), false);
  assert.equal(isLrc('[ti:제목만]'), false);
});

test('정보 줄이 많아도 시간 줄이 대부분이면 LRC', () => {
  assert.equal(isLrc(SAMPLE), true);
});

test('파싱: 소수 자릿수, 한 줄에 시간 여러 개, 빈 줄, 정렬', () => {
  assert.deepEqual(parseLrc(SAMPLE), [
    { time: 12, text: '첫 줄' },
    { time: 15.5, text: '둘째 줄' },
    { time: 20.123, text: '후렴' },
    { time: 30, text: '' },
    { time: 70, text: '후렴' },
  ]);
});

test('파싱: offset 태그는 양수면 가사를 빨리', () => {
  const lines = parseLrc('[offset:+500]\n[00:10.00]a\n[00:00.20]b');
  assert.deepEqual(lines, [
    { time: 0, text: 'b' },
    { time: 9.5, text: 'a' },
  ]);
});

test('파싱: 단어별 시간 태그는 지운다', () => {
  assert.deepEqual(parseLrc('[00:01.00]<00:01.00>안녕 <00:01.50>하세요'), [
    { time: 1, text: '안녕 하세요' },
  ]);
});

test('현재 줄 찾기', () => {
  const lines = parseLrc(SAMPLE);
  assert.equal(lineIndexAt(lines, 0), -1);
  assert.equal(lineIndexAt(lines, 11.99), -1);
  assert.equal(lineIndexAt(lines, 12), 0);
  assert.equal(lineIndexAt(lines, 16), 1);
  assert.equal(lineIndexAt(lines, 999), 4);
  assert.equal(lineIndexAt([], 5), -1);
});

test('시간 표시 반올림', () => {
  assert.equal(formatTime(0), '00:00.00');
  assert.equal(formatTime(59.999), '01:00.00');
  assert.equal(formatTime(75.5, false), '01:15');
  assert.equal(formatTime(-3), '00:00.00');
});

test('LRC 만들기 → 다시 읽으면 같다', () => {
  const lines = [
    { time: 1.25, text: '하나' },
    { time: 63.4, text: '둘' },
  ];
  assert.equal(toLrc(lines), '[00:01.25]하나\n[01:03.40]둘');
  assert.deepEqual(parseLrc(toLrc(lines)), lines);
});

test('탭 싱크용 줄: 빈 줄·정보 줄 빼고', () => {
  assert.deepEqual(lyricLines('[ti:x]\n하나\n\n  둘  \n'), ['하나', '둘']);
  assert.deepEqual(lyricLines(SAMPLE), ['첫 줄', '둘째 줄', '후렴', '후렴']);
});
