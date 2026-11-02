// 음성 인식이 글자를 조금씩 늦게·틀리게 주는 상황을 흉내 내서 따라가는지 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceTracker } from '../voice.js';

const LYRICS = [
  '나는 읽기 쉬운 마음이야',
  '당신도 스윽 훑고 가셔요',
  '달랠 길 없는 외로운 마음 있지',
  '머물다 가셔요',
  '사랑을 사랑을 해줘요',
  '할 수 있다면 그럴 수만 있다면',
  '새하얀 빛으로 그댈 비춰 줄게요',
  '사랑을 사랑을 해줘요',
];

// 단어 하나씩 부르는 것처럼 인식 결과가 늘어난다. mangle로 글자를 틀리게
function sing(tracker, lines, mangle = (w) => w) {
  const seen = [];
  let heard = '';
  lines.forEach((line, li) => {
    for (const word of line.split(' ')) {
      heard += ` ${mangle(word)}`;
      tracker.hear(heard);
      seen.push([li, tracker.line]);
    }
  });
  return seen;
}

// 줄의 첫 단어를 부를 땐 아직 전 줄일 수 있으니, 줄의 마지막 단어 시점에 맞는지 본다
const lastWordOk = (tracker, lines, seen) => {
  let k = 0;
  return lines.map((line) => {
    k += line.split(' ').length;
    return seen[k - 1][1] === seen[k - 1][0];
  });
};

test('그대로 부르면 줄마다 따라간다', () => {
  const t = new VoiceTracker(LYRICS);
  const seen = sing(t, LYRICS);
  assert.ok(lastWordOk(t, LYRICS, seen).every(Boolean), JSON.stringify(seen));
});

test('인식이 틀려도(받침·모음 틀림, 띄어쓰기 달라짐) 따라간다', () => {
  const typos = { 마음이야: '마미야', 스윽: '쓱', 훑고: '훌고', 외로운: '외루운', 그럴: '그럼', 비춰: '비쳐', 줄게요: '줄께요' };
  const t = new VoiceTracker(LYRICS);
  const seen = sing(t, LYRICS, (w) => typos[w] ?? w);
  const ok = lastWordOk(t, LYRICS, seen);
  assert.ok(ok.filter(Boolean).length >= LYRICS.length - 1, JSON.stringify(seen));
});

test('같은 후렴이 두 번 나와도 지금 위치 다음 것을 고른다', () => {
  const t = new VoiceTracker(LYRICS);
  sing(t, LYRICS.slice(0, 7));
  assert.equal(t.line, 6);
  t.hear('그댈 비춰 줄게요 사랑을 사랑을 해줘요');
  assert.equal(t.line, 7);
});

test('대본에 없는 말(애드리브·잡담)엔 안 움직인다', () => {
  const t = new VoiceTracker(LYRICS);
  sing(t, LYRICS.slice(0, 2));
  const before = t.pos;
  assert.equal(t.hear('여러분 감사합니다 박수 한번 주세요'), false);
  assert.equal(t.pos, before);
});

test('한 줄 건너뛰고 불러도 따라간다', () => {
  const t = new VoiceTracker(LYRICS);
  sing(t, LYRICS.slice(0, 2));
  t.hear('머물다 가셔요');
  assert.equal(t.line, 3);
});

test('줄을 눌러 위치를 옮기면 거기서부터', () => {
  const t = new VoiceTracker(LYRICS);
  t.jumpToLine(5);
  assert.equal(t.line, 5);
  t.hear('할 수 있다면 그럴 수만');
  assert.equal(t.line, 5);
});

test('너무 짧은 인식은 안 믿는다', () => {
  const t = new VoiceTracker(LYRICS);
  assert.equal(t.hear('음'), false);
  assert.equal(t.pos, 0);
});

test('한 줄을 다 부르면 강조는 다음 줄로', () => {
  const t = new VoiceTracker(['하나 둘 셋', '', '넷 다섯 여섯']);
  assert.equal(t.focusLine, 0);
  t.hear('하나 둘');
  assert.equal(t.focusLine, 0);
  t.hear('하나 둘 셋');
  assert.equal(t.focusLine, 2); // 빈 줄(간주)은 건너뜀
  t.hear('하나 둘 셋 넷 다섯 여섯');
  assert.equal(t.focusLine, 2); // 끝이면 마지막 줄
});
