import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchQueries, rankResults, searchLrclib, findLyrics } from '../lrclib.js';

test('꼬리표 떼기: [MV], (Official Audio), Lyric Video, 따옴표', () => {
  assert.equal(searchQueries('잔나비 - 주저하는 연인들을 위해 (Official Audio)')[0], '잔나비 주저하는 연인들을 위해');
  assert.equal(searchQueries("DAY6 (데이식스) '한 페이지가 될 수 있게' Lyric Video")[1], 'DAY6 한 페이지가 될 수 있게');
  assert.ok(!searchQueries('[MV] 실리카겔 (Silica Gel) - NO PAIN [4K]').some((q) => /MV|4K/.test(q)));
});

test('아티스트(한글)·제목(한글) 괄호 조합도 후보로', () => {
  const qs = searchQueries('[MV] IU(아이유) _ Through the Night(밤편지)');
  assert.deepEqual(qs.slice(0, 3), ['IU 아이유 Through the Night 밤편지', 'IU Through the Night', '아이유 밤편지']);
  assert.ok(qs.includes('밤편지'));
});

test('채널 이름을 가수로 써 본다', () => {
  const qs = searchQueries('주저하는 연인들을 위해 | Official Audio', '잔나비 (JANNABI) Official');
  assert.ok(qs.includes('주저하는 연인들을 위해'));
});

test('빈 제목이면 후보 없음', () => {
  assert.deepEqual(searchQueries(''), []);
  assert.deepEqual(searchQueries('[MV] (Official Video)'), []);
});

test('결과 정리: 싱크 먼저, 중복·빈 가사 제거', () => {
  const r = rankResults([
    { trackName: 'a', artistName: 'x', duration: 200, plainLyrics: 'p' },
    { trackName: 'a', artistName: 'x', duration: 200, syncedLyrics: '[00:01.00]s' },
    { trackName: 'a', artistName: 'x', duration: 200.4, syncedLyrics: '[00:01.00]s' },
    { trackName: 'b', artistName: 'y', duration: 100 },
  ]);
  assert.deepEqual(r.map((x) => !!x.syncedLyrics), [true, false]);
});

const reply = (status, body) => ({ ok: status === 200, status, json: async () => body });

test('바쁨(503)이면 다시 시도해서 받는다', async () => {
  const calls = [];
  const fetchFn = async (url) => (calls.push(url), calls.length < 3 ? reply(503) : reply(200, [{ trackName: 't', artistName: 'a', plainLyrics: 'x' }]));
  const r = await searchLrclib('밤 편지', { fetchFn, sleep: async () => {} });
  assert.equal(r.length, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].endsWith('q=%EB%B0%A4%20%ED%8E%B8%EC%A7%80'));
});

test('계속 바쁘면 에러', async () => {
  await assert.rejects(searchLrclib('x', { fetchFn: async () => reply(503), sleep: async () => {} }));
});

test('후보를 차례로: 0건이면 다음 검색어', async () => {
  const fetchFn = async (url) => reply(200, url.includes('hit') ? [{ trackName: 't', artistName: 'a', syncedLyrics: '[00:01.00]x' }] : []);
  const r = await findLyrics(['miss', 'hit', 'never'], { fetchFn, sleep: async () => {} });
  assert.equal(r.query, 'hit');
  assert.equal(r.results.length, 1);
});

test('곡 제목이 영상 제목에 들어 있나', async () => {
  const title = "[MV] IU(아이유) _ Through the Night(밤편지)";
  const { matchesTitle } = await import('../lrclib.js');
  assert.ok(matchesTitle({ trackName: '밤편지 (Through the Night)' }, title));
  assert.ok(matchesTitle({ trackName: 'Through the Night' }, title));
  assert.ok(!matchesTitle({ trackName: '좋은 날' }, title));
  assert.ok(!matchesTitle({ trackName: 'Night' }, 'Nightmare')); // 단어 일부는 X
});

test('제목이 안 맞는 결과만 나오면 다음 검색어로, 끝까지 안 맞으면 sure: false', async () => {
  const songs = { '데이식스': [{ trackName: '예뻤어', artistName: 'DAY6', syncedLyrics: '[00:01.00]x' }],
    'DAY6 한 페이지가 될 수 있게': [{ trackName: '한 페이지가 될 수 있게', artistName: 'DAY6', syncedLyrics: '[00:01.00]y' }] };
  const fetchFn = async (url) => reply(200, songs[decodeURIComponent(url.split('q=')[1])] ?? []);
  const opts = { fetchFn, sleep: async () => {}, title: "DAY6 (데이식스) '한 페이지가 될 수 있게' Lyric Video" };
  const hit = await findLyrics(['데이식스', 'DAY6 한 페이지가 될 수 있게'], opts);
  assert.equal(hit.results[0].trackName, '한 페이지가 될 수 있게');
  assert.equal(hit.sure, true);
  const miss = await findLyrics(['데이식스'], opts);
  assert.equal(miss.sure, false);
  assert.equal(miss.results[0].trackName, '예뻤어');
});
