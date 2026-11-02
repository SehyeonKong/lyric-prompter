// 가사 자동 찾기: 무료 싱크 가사 DB LRCLIB(lrclib.net) 검색.
// 유튜브 제목은 [MV]·(Official Video) 같은 꼬리표가 붙어 있어 그대로 찾으면 0건이라,
// 꼬리표를 떼고 여러 모양의 검색어를 만들어 차례로 찾는다.

const TAG = /official|m\/?v\b|music video|lyrics?|audio|visuali[sz]er|live|clip|teaser|performance|\b4k\b|\bhd\b|remaster|color coded|가사|뮤직비디오|공식|라이브|자막|듣기/i;
const TAG_WORDS = new RegExp(
  String.raw`\b(official|m\/?v|music video|lyric video|lyrics?|video|audio|visuali[sz]er|live|clip|teaser|performance|4k|hd|remastered?|color coded)\b|가사|뮤직비디오|공식|라이브|자막|듣기`,
  'gi',
);
const PAREN = /[(（]([^)）]*)[)）]/g;
const SEP = /\s*[|_–—~/]\s*|\s+-\s+/;

const tidy = (s) =>
  s
    .replace(/[-_|–—~/'"‘’“”:#@·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripBrackets = (s) => s.replace(/[[【「『〔][^\]】」』〕]*[\]】」』〕]/g, ' ');

// 유튜브 제목(과 채널 이름)에서 검색어 후보들을 그럴듯한 순서로
export function searchQueries(title, channel = '') {
  let t = (title ?? '').normalize('NFC');
  t = stripBrackets(t); // [MV] 【가사】 같은 꼬리표 통째로
  t = t.replace(PAREN, (m) => (TAG.test(m) ? ' ' : m)); // (Official Video) 같은 괄호
  t = t.replace(TAG_WORDS, ' ');

  const parts = t.split(SEP).map((p) => p.trim()).filter(Boolean);
  const titlePart = parts.length > 1 ? parts.at(-1) : '';
  const withParens = (s) => tidy(s.replace(PAREN, ' $1 ')); // 괄호 안 글자도 살림
  const noParens = (s) => tidy(s.replace(PAREN, ' '));
  const insideParens = (s) => tidy([...s.matchAll(PAREN)].map((m) => m[1]).join(' '));
  const artist = tidy(stripBrackets(channel ?? '').replace(PAREN, ' ').replace(/official|topic|채널|channel/gi, ' '));

  const all = [
    withParens(t),
    noParens(t),
    insideParens(t),
    artist && !t.includes(artist) && `${artist} ${noParens(t)}`,
    titlePart && artist && `${artist} ${noParens(titlePart)}`,
    titlePart && withParens(titlePart),
    titlePart && noParens(titlePart),
    titlePart && insideParens(titlePart),
  ];
  return [...new Set(all.filter((q) => q && q.length >= 2))];
}

// 싱크 있는 것 먼저, 같은 곡·가수·길이는 하나만
export function rankResults(results) {
  const seen = new Set();
  return [...results]
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))
    .filter((r) => {
      const key = `${r.trackName}|${r.artistName}|${Math.round(r.duration ?? 0)}|${!!r.syncedLyrics}`;
      if (seen.has(key) || !(r.syncedLyrics || r.plainLyrics)) return false;
      seen.add(key);
      return true;
    });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 서버가 자주 '바쁨(503)'이라 몇 번 다시 시도한다. fetch·sleep은 테스트에서 바꿔 끼운다.
export async function searchLrclib(q, { fetchFn = fetch, sleep = wait, tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchFn(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) return rankResults(await res.json());
      if (res.status !== 503 && res.status !== 429) throw new Error(`LRCLIB ${res.status}`);
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await sleep(1500 * (i + 1));
  }
  throw new Error('LRCLIB 서버가 바빠');
}

const plain = (s) => (s ?? '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// 찾은 곡의 제목(또는 괄호 속 제목)이 영상 제목 안에 들어 있나
export function matchesTitle(result, title) {
  const t = ` ${plain(title)} `;
  const name = result.trackName ?? '';
  const names = [name, name.replace(PAREN, ' '), ...[...name.matchAll(PAREN)].map((m) => m[1])];
  return names.map(plain).some((n) => n.length >= 2 && t.includes(` ${n} `));
}

// 후보 검색어를 차례로 찾는다. title을 주면 제목이 맞는 결과가 나올 때까지 계속 찾고,
// 끝까지 안 맞으면 처음 나온 결과를 sure: false로 돌려준다(자동으로 채우지 말 것).
export async function findLyrics(queries, { title, ...options } = {}) {
  let first = null;
  for (const q of queries) {
    const results = await searchLrclib(q, options);
    if (!results.length) continue;
    if (!title) return { query: q, results, sure: true };
    const matched = results.filter((r) => matchesTitle(r, title));
    if (matched.length) return { query: q, results: [...matched, ...results.filter((r) => !matched.includes(r))], sure: true };
    first ??= { query: q, results, sure: false };
  }
  return first ?? { query: queries[0] ?? '', results: [], sure: false };
}
