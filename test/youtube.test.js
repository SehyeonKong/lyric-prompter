import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeId } from '../youtube.js';

test('유튜브 링크 여러 모양에서 영상 ID', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s&list=RDabc`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}&si=xyz`,
    `https://youtu.be/${id}?si=abc`,
    `youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
    id,
  ]) {
    assert.equal(parseYouTubeId(url), id, url);
  }
});

test('유튜브가 아니거나 이상하면 null', () => {
  for (const s of ['', '   ', 'https://vimeo.com/123', 'https://youtube.com/watch?v=short', '그냥 글', null]) {
    assert.equal(parseYouTubeId(s), null, String(s));
  }
});
