#!/usr/bin/env node
// 유튜브 자막으로 내 가사에 시간 입히기 (맥에서 실행, yt-dlp 필요)
//
//   npm run yt-sync -- <유튜브 링크> [가사.txt] [--no-copy]
//
// 가사 파일을 안 주면 클립보드의 가사를 쓴다. 결과(LRC)는 클립보드에 복사되니 앱 가사 칸에 붙여넣으면 된다.
// 직접 단 한국어 자막을 먼저 쓰고, 없으면 자동 자막을 쓴다(노래에선 부정확한 경우가 많음).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJson3 } from '../captions.js';
import { alignLyrics } from '../align.js';
import { lyricLines, toLrc, formatTime } from '../lrc.js';
import { parseYouTubeId } from '../youtube.js';

const args = process.argv.slice(2);
const noCopy = args.includes('--no-copy'); // 클립보드 대신 화면에 LRC 출력
const [link, lyricsFile] = args.filter((a) => a !== '--no-copy');
const id = parseYouTubeId(link);
if (!id) {
  console.error('사용법: npm run yt-sync -- <유튜브 링크> [가사.txt]');
  process.exit(1);
}

const lyrics = lyricsFile ? fs.readFileSync(lyricsFile, 'utf8') : execFileSync('pbpaste', { encoding: 'utf8' });
const lines = lyricLines(lyrics);
if (lines.length < 2) {
  console.error('가사가 비어 있어. 가사를 복사해 두거나 파일로 줘.');
  process.exit(1);
}

function ytDlp() {
  for (const p of ['yt-dlp', path.join(os.homedir(), '.local/bin/yt-dlp'), '/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']) {
    try {
      execFileSync(p, ['--version'], { stdio: 'ignore' });
      return p;
    } catch {}
  }
  console.error('yt-dlp를 못 찾았어. 설치: brew install yt-dlp');
  process.exit(1);
}

// kind: 'subs'(직접 단 자막) | 'auto'(자동 자막)
function download(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-sync-'));
  const args = ['--skip-download', '--sub-format', 'json3', '-o', path.join(dir, '%(id)s.%(ext)s'), '--quiet', '--no-warnings'];
  args.push(...(kind === 'subs' ? ['--write-subs', '--sub-langs', 'ko,ko-KR'] : ['--write-auto-subs', '--sub-langs', 'ko-orig,ko']));
  try {
    execFileSync(ytDlp(), [...args, `https://www.youtube.com/watch?v=${id}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.error('자막을 받다가 실패했어:', String(e.stderr ?? e.message).trim().split('\n').at(-1));
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json3'));
  const file = files.find((f) => f.includes('.ko-orig.')) ?? files[0];
  const cues = file ? parseJson3(fs.readFileSync(path.join(dir, file), 'utf8')) : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return cues;
}

let kind = 'subs';
let cues = download('subs');
if (!cues.length) {
  kind = 'auto';
  cues = download('auto');
}
if (!cues.length) {
  console.error('이 영상엔 한국어 자막이 없어. 앱에서 탭 싱크로 만들어줘.');
  process.exit(2);
}

const rows = alignLyrics(lines, cues);
const matched = rows.filter((r) => !r.guessed).length;
const ratio = matched / rows.length;

console.log(`자막: ${kind === 'subs' ? '직접 단 한국어 자막' : '자동 자막(노래에선 부정확할 수 있음)'} · ${cues.length}개`);
for (const r of rows) {
  const mark = r.guessed ? '?' : r.confidence >= 0.7 ? '✓' : '~';
  console.log(`  ${mark} ${formatTime(r.time)}  ${r.text}`);
}
console.log(`\n${rows.length}줄 중 ${matched}줄을 자막으로 맞췄어 (✓ 잘 맞음, ~ 대충, ? 앞뒤로 추정)`);

const lrc = toLrc(rows);
if (noCopy) {
  console.log(`\n${lrc}`);
} else {
  execFileSync('pbcopy', { input: lrc });
  console.log('→ 클립보드에 복사했어. 앱 가사 칸에 붙여넣고, 싱크 화면 ‘시간 확인’에서 한번 들어봐.');
}
if (ratio < 0.6) {
  console.log('⚠️ 맞춘 줄이 적어서 믿기 어려워. 앱에서 탭 싱크로 만드는 걸 추천해.');
  process.exitCode = 3;
}
