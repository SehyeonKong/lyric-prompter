import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignLyrics, charCost } from '../align.js';

const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

test('자모가 비슷하면 반쯤 맞음', () => {
  assert.equal(charCost('가', '가'), 0);
  assert.ok(charCost('마', '미') < 0.5); // 초성·받침 같음
  assert.ok(charCost('음', '은') < 0.5);
  assert.equal(charCost('가', 'a'), 1);
});

test('줄 나눔이 달라도 각 줄 시작 시간을 찾는다', () => {
  // 자막은 두 줄을 한 번에, 한 줄을 둘로 나눠 보여줌
  const cues = [
    { time: 10, text: '이 밤 그날의 반딧불을 당신의' },
    { time: 16, text: '창 가까이 보낼게요' },
    { time: 22, text: '[음악]' },
    { time: 30, text: '사랑한다는' },
    { time: 32, text: '말이에요' },
  ];
  const r = alignLyrics(['이 밤 그날의 반딧불을', '당신의 창 가까이 보낼게요', '사랑한다는 말이에요'], cues);
  assert.ok(near(r[0].time, 10), JSON.stringify(r));
  assert.ok(r[1].time > 13 && r[1].time < 16, JSON.stringify(r)); // 자막 줄 뒷부분에서 시작
  assert.ok(near(r[2].time, 30));
  assert.ok(r.every((x) => !x.guessed));
});

test('자동 자막처럼 틀린 글자가 섞여도 맞춘다', () => {
  const cues = [
    { time: 20, text: '이렇게 쉬운 마미야' },
    { time: 24, text: '다음 쉼터가 썰코' },
    { time: 30, text: '으 으 으' },
    { time: 34, text: '그대 날개에 너무 괴로울' },
  ];
  const r = alignLyrics(['이렇게 쉬운 마음이야', '다음 쉼표가 설레고', '그대 날개에 너무 괴로워'], cues);
  assert.ok(near(r[0].time, 20));
  assert.ok(near(r[1].time, 24));
  assert.ok(near(r[2].time, 34));
});

test('후렴이 반복돼도 순서대로 짝짓는다', () => {
  const cues = [
    { time: 5, text: '첫 소절이야' },
    { time: 10, text: '반복되는 후렴' },
    { time: 15, text: '두번째 소절' },
    { time: 20, text: '반복되는 후렴' },
  ];
  const r = alignLyrics(['첫 소절이야', '반복되는 후렴', '두번째 소절', '반복되는 후렴'], cues);
  assert.deepEqual(r.map((x) => Math.round(x.time)), [5, 10, 15, 20]);
});

test('자막에 없는 줄은 앞뒤 사이로 채우고 표시한다', () => {
  const cues = [
    { time: 10, text: '하나 둘 셋' },
    { time: 20, text: '다섯 여섯 일곱' },
  ];
  const r = alignLyrics(['하나 둘 셋', '자막엔 없는 줄', '다섯 여섯 일곱'], cues);
  assert.equal(r[1].guessed, true);
  assert.ok(r[1].time > 10 && r[1].time < 20);
  assert.ok(near(r[2].time, 20));
});

test('자막이 비면 전부 추정, 시간은 거꾸로 가지 않음', () => {
  const r = alignLyrics(['a', 'b'], []);
  assert.ok(r.every((x) => x.guessed));
});
