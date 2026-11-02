// 자막 파일 → [{ time, end, text }]. yt-dlp가 받는 json3(단어별 시간 포함)와 vtt·srt를 읽는다.

export function parseJson3(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const cues = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs) continue;
    const start = (ev.tStartMs ?? 0) / 1000;
    const end = start + (ev.dDurationMs ?? 0) / 1000;
    const segs = ev.segs.filter((s) => s.utf8?.trim());
    segs.forEach((s, k) => {
      const time = start + (s.tOffsetMs ?? 0) / 1000;
      const next = segs[k + 1];
      cues.push({ time, end: next ? start + (next.tOffsetMs ?? 0) / 1000 : end, text: s.utf8.trim() });
    });
  }
  return cues.sort((a, b) => a.time - b.time);
}

const STAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const seconds = (s) => {
  const m = s.match(STAMP);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : null;
};

// vtt·srt 공통: "시작 --> 끝" 줄 다음 글. 자동 자막의 <00:00:01.000><c> 꼬리표는 지우고,
// 굴러가며 반복되는 줄은 새로 나온 부분만 남긴다.
export function parseVtt(text) {
  const cues = [];
  let prev = '';
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    const body = lines
      .slice(at + 1)
      .map((l) => l.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean);
    const fresh = body.filter((l) => !prev.includes(l));
    prev = body.join('\n');
    const t = fresh.join(' ').trim();
    const time = seconds(a);
    if (t && time !== null) cues.push({ time, end: seconds(b) ?? undefined, text: t });
  }
  return cues;
}

export function parseCaptions(text) {
  const s = text.trim();
  return s.startsWith('{') ? parseJson3(s) : parseVtt(s);
}
