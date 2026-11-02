import { isLrc, parseLrc, lineIndexAt, formatTime, toLrc, lyricLines } from './lrc.js';
import { HOP, encodeFrames, decodeFrames, fillGaps } from './features.js';
import { Follower } from './follow.js';
import { openMic, openTabAudio, canCaptureTab, listen } from './audio.js';
import { parseYouTubeId, createPlayer, fetchTitle, PLAYING } from './youtube.js';

const $ = (id) => document.getElementById(id);

// ── 저장: 이 기기 브라우저(localStorage)에만 ──
const KEY = 'lyric-prompter:v1';
const db = loadDb();

function loadDb() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.songs)) return data;
  } catch {}
  return { songs: [], fontSize: null, seeded: false };
}

function saveDb() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    toast('저장 못 했어: 브라우저 저장 공간을 쓸 수 없어');
  }
}

// 사파리가 오래 안 연 사이트 저장소를 지우지 않게 요청 (홈 화면에 추가한 앱이면 원래 안전)
navigator.storage?.persist?.().catch(() => {});

const newId = () =>
  crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
const getSong = (id) => db.songs.find((s) => s.id === id);

const SAMPLE = `[00:01.00]이건 연습용 예시 곡이야
[00:04.00]노란 줄이 지금 부를 줄
[00:07.00]그 아래 밝은 줄이 다음 줄
[00:10.00]줄을 누르면 그 줄로 이동해
[00:13.00]
[00:16.00]박자가 어긋나면 아래 ± 버튼으로
[00:19.00]가사를 빨리, 늦게 맞출 수 있어
[00:22.00]시간 없는 가사는 자동 스크롤돼
[00:25.00]다 봤으면 편집에서 지워도 돼`;

if (!db.seeded) {
  db.seeded = true;
  db.songs.push({ id: newId(), title: '예시: 사용법', text: SAMPLE, speed: 4, offset: 0, updatedAt: Date.now() });
  saveDb();
}

// ── 공통 ──
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

const hint = (text) => Object.assign(document.createElement('p'), { className: 'hint center', textContent: text });

const defaultFontSize = () => Math.round(Math.min(64, Math.max(28, innerWidth * 0.05)));
const fontSize = () => db.fontSize ?? defaultFontSize();

function applyFontSize() {
  document.documentElement.style.setProperty('--fs', `${fontSize()}px`);
}

function changeFontSize(step) {
  db.fontSize = Math.min(120, Math.max(20, fontSize() + step));
  applyFontSize();
  saveDb();
}

// 노래하는 동안 화면이 꺼지지 않게
let wakeLock = null;
let wantAwake = false;
async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantAwake) keepAwake(true);
});

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const fullscreenSupported = () =>
  !isStandalone() &&
  !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

function toggleFullscreen() {
  const root = document.documentElement;
  if (document.fullscreenElement ?? document.webkitFullscreenElement) {
    (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
  } else {
    (root.requestFullscreen ?? root.webkitRequestFullscreen).call(root)?.catch?.(() => {});
  }
}

// ── 화면 전환: #/  #/edit/:id  #/play/:id  #/sync/:id ──
const VIEWS = ['list', 'edit', 'play', 'sync'];
let leaveView = null;

function route() {
  leaveView?.();
  leaveView = null;
  const [, name = '', id = ''] = location.hash.split('/');
  const song = getSong(id);
  let view = 'list';
  if (name === 'edit' && (id === 'new' || song)) view = 'edit';
  else if ((name === 'play' || name === 'sync') && song) view = name;

  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  keepAwake(view === 'play' || view === 'sync');
  if (view === 'list') showList();
  else if (view === 'edit') showEdit(song);
  else if (view === 'play') leaveView = showPlay(song);
  else leaveView = showSync(song);
}

// ── 목록 ──
function showList() {
  document.title = '가사 프롬프터';
  renderList();
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const songs = db.songs
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.text.toLowerCase().includes(q))
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title, 'ko'));
  $('song-list').replaceChildren(...songs.map(songItem));
  $('empty').hidden = db.songs.length > 0;
}

const badge = (className, textContent) =>
  Object.assign(document.createElement('span'), { className: `badge ${className}`, textContent });

function songItem(s) {
  const timed = isLrc(s.text);
  const li = document.createElement('li');
  const play = Object.assign(document.createElement('a'), { className: 'song', href: `#/play/${s.id}` });
  play.append(
    Object.assign(document.createElement('span'), { className: 'title', textContent: s.title }),
    timed ? badge('sync', '싱크') : badge('', '스크롤'),
  );
  if (timed && s.ref) play.append(badge('follow', '따라가기'));
  const edit = Object.assign(document.createElement('a'), {
    className: 'btn ghost',
    href: `#/edit/${s.id}`,
    textContent: '편집',
  });
  li.append(play, edit);
  return li;
}

$('search').addEventListener('input', renderList);

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ songs: db.songs }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `가사-백업-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const songs = (data.songs ?? []).filter(
      (s) => s && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.text === 'string',
    );
    for (const s of songs) {
      const i = db.songs.findIndex((x) => x.id === s.id);
      if (i >= 0) db.songs[i] = s;
      else db.songs.push(s);
    }
    saveDb();
    renderList();
    toast(`${songs.length}곡 가져왔어`);
  } catch {
    toast('백업 파일을 읽지 못했어');
  }
});

// ── 편집 ──
let editing = null; // 새 곡이면 null

function showEdit(song) {
  editing = song ?? null;
  document.title = song ? `${song.title} 편집` : '새 곡';
  $('edit-heading').textContent = song ? '가사 편집' : '새 곡';
  $('f-title').value = song?.title ?? '';
  $('f-youtube').value = song?.youtube ? `https://youtu.be/${song.youtube}` : '';
  $('f-text').value = song?.text ?? '';
  $('f-delete').hidden = !song;
  updateMode();
  if (!song) $('f-title').focus();
}

function updateMode() {
  const text = $('f-text').value;
  const learned = editing?.ref ? ' 음악도 기억해 둬서 무대에서 🎤 따라가기를 쓸 수 있어.' : '';
  $('f-mode').textContent = !text.trim()
    ? ''
    : isLrc(text)
      ? `싱크 가사 (${parseLrc(text).length}줄) — ‘시작’을 음악 재생과 같이 누르면 시간에 맞춰 줄이 강조돼.${learned}`
      : '일반 가사 — 자동 스크롤로 올라가. ‘싱크 만들기’로 줄마다 시간을 붙일 수 있어.';
}

$('f-text').addEventListener('input', updateMode);

// 유튜브 링크를 넣었는데 제목이 비어 있으면 영상 제목으로 채운다
$('f-youtube').addEventListener('change', async () => {
  const id = parseYouTubeId($('f-youtube').value);
  if (!id || $('f-title').value.trim()) return;
  const title = await fetchTitle(id);
  if (title && !$('f-title').value.trim()) $('f-title').value = title;
});

function commitEdit() {
  const title = $('f-title').value.trim();
  const text = $('f-text').value.replace(/\s+$/, '');
  const link = $('f-youtube').value.trim();
  const youtube = link ? parseYouTubeId(link) : null;
  if (!title) return toast('제목을 적어줘'), null;
  if (!text.trim()) return toast('가사를 붙여넣어줘'), null;
  if (link && !youtube) return toast('유튜브 링크를 못 알아봤어'), null;
  if (editing) {
    // 기억한 음악은 그 영상 시간 기준이라, 영상이 바뀌면 버린다
    if (editing.ref && (editing.youtube ?? null) !== youtube) {
      delete editing.ref;
      toast('영상이 바뀌어서 기억한 음악을 지웠어');
    }
    Object.assign(editing, { title, text, youtube, updatedAt: Date.now() });
  } else {
    editing = { id: newId(), title, text, youtube, speed: 4, offset: 0, updatedAt: Date.now() };
    db.songs.push(editing);
  }
  saveDb();
  return editing;
}

$('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!commitEdit()) return;
  toast('저장했어');
  location.hash = '#/';
});

$('f-sync').addEventListener('click', () => {
  const song = commitEdit();
  if (song) location.hash = `#/sync/${song.id}`;
});

$('f-delete').addEventListener('click', () => {
  if (!editing || !confirm(`‘${editing.title}’ 지울까?`)) return;
  db.songs = db.songs.filter((s) => s !== editing);
  saveDb();
  location.hash = '#/';
});

// ── 무대: 싱크 가사는 시간(또는 음악 따라가기)에 맞춰 강조, 일반 가사는 자동 스크롤 ──
const FOLLOW_STATUS = {
  listening: () => '듣는 중',
  quiet: () => '조용함 · 기다리는 중',
  following: (f) => `따라가는 중 · 빠르기 ${Math.round(f.rate * 100)}%`,
  coasting: () => '잘 안 들림 · 하던 빠르기로',
  lost: () => '위치 찾는 중',
};

function showPlay(song) {
  song.lastPlayed = Date.now();
  if (!Number.isFinite(song.speed)) song.speed = 4;
  if (!Number.isFinite(song.offset)) song.offset = 0;
  saveDb();
  document.title = song.title;
  applyFontSize();

  const stage = $('view-play');
  const scroller = $('scroller');
  const box = $('lines');
  const controls = $('controls');
  const status = $('p-status');
  const timed = isLrc(song.text);
  const lines = timed ? parseLrc(song.text) : [];
  const refFrames = timed && song.ref ? decodeFrames(song.ref.frames) : null;

  box.className = timed ? 'lines timed' : 'lines';
  box.replaceChildren(...(timed ? lines.map(timedLine) : plainLines(song.text)));
  scroller.scrollTop = 0;
  $('p-title').textContent = song.title;
  $('p-clock').hidden = !timed;
  $('g-offset').hidden = !timed;
  $('g-speed').hidden = timed;
  $('p-fs').hidden = !fullscreenSupported();
  $('p-follow').hidden = !refFrames;

  const state = { running: false, elapsed: 0, startedAt: 0, pos: 0, lastSet: 0, lastFrame: 0, current: -2, raf: 0 };
  // 음악 따라가기: 켜져 있으면 재생 중 시간은 마이크로 들은 위치에서 온다
  const follow = { enabled: !!refFrames && song.follow !== false, follower: null, listener: null, starting: false };
  const sec = () => performance.now() / 1000;
  const now = () => {
    if (!state.running) return state.elapsed;
    if (follow.listener) return follow.follower.position(sec());
    return state.elapsed + (performance.now() - state.startedAt) / 1000;
  };
  const maxScroll = () => scroller.scrollHeight - scroller.clientHeight;

  function setRunning(on) {
    if (on === state.running) return;
    if (on) {
      state.startedAt = state.lastFrame = performance.now();
      state.pos = state.lastSet = scroller.scrollTop;
      state.raf = requestAnimationFrame(frame);
    } else {
      state.elapsed = now();
      cancelAnimationFrame(state.raf);
      stopFollow();
    }
    state.running = on;
    if (on && follow.enabled) startFollow();
    $('p-toggle').textContent = on ? '❚❚ 멈춤' : state.elapsed > 0 ? '▶ 계속' : '▶ 시작';
    showStatus();
    poke();
  }

  // 버튼 클릭 안에서 불러야 한다(아이패드 소리 정책)
  function startFollow() {
    if (follow.listener || follow.starting) return;
    follow.starting = true;
    const ctx = new AudioContext();
    openMic()
      .then((stream) => {
        follow.starting = false;
        if (!state.running || !follow.enabled || ac.signal.aborted) {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close().catch(() => {});
          return;
        }
        follow.follower ??= new Follower(refFrames, { hop: song.ref.hop ?? HOP });
        follow.follower.reset(now(), sec()); // 지금 시간 위치에서 이어서 듣기 시작
        follow.listener = listen(ctx, stream, (chroma, level) => follow.follower.push(chroma, level, sec()));
      })
      .catch(() => {
        follow.starting = false;
        follow.enabled = false;
        ctx.close().catch(() => {});
        showFollow();
        toast('마이크를 켤 수 없어서 시간 기준으로 진행할게');
      });
    showStatus();
  }

  function stopFollow() {
    follow.listener?.stop();
    follow.listener = null;
  }

  function toggleFollow() {
    follow.enabled = !follow.enabled;
    song.follow = follow.enabled;
    saveDb();
    if (state.running && follow.enabled) startFollow();
    if (state.running && !follow.enabled) {
      state.elapsed = now();
      state.startedAt = performance.now();
      stopFollow();
    }
    showFollow();
  }

  function showFollow() {
    $('p-follow').classList.toggle('on', follow.enabled);
    $('p-follow').textContent = follow.enabled ? '🎤 따라가기 켬' : '🎤 따라가기 끔';
    showStatus();
  }

  function showStatus() {
    status.hidden = !(follow.enabled && state.running);
    if (status.hidden) return;
    const f = follow.listener ? follow.follower : null;
    const text = f ? FOLLOW_STATUS[f.state](f) : '마이크 켜는 중';
    if (status.textContent !== text) status.textContent = text;
    status.dataset.state = f?.state ?? 'listening';
  }

  function frame(t) {
    if (timed) {
      syncLine();
      showStatus();
    } else {
      const dt = Math.min(0.1, (t - state.lastFrame) / 1000);
      state.lastFrame = t;
      // 손으로 스크롤했으면 그 자리부터 이어서
      if (Math.abs(scroller.scrollTop - state.lastSet) > 2) state.pos = scroller.scrollTop;
      state.pos = Math.min(maxScroll(), state.pos + (song.speed / 10) * fontSize() * 1.5 * dt);
      scroller.scrollTop = state.pos;
      state.lastSet = scroller.scrollTop;
      if (state.pos >= maxScroll()) return setRunning(false);
    }
    state.raf = requestAnimationFrame(frame);
  }

  function syncLine(force = false) {
    const t = now();
    const clock = formatTime(t, false);
    if ($('p-clock').textContent !== clock) $('p-clock').textContent = clock;
    const idx = lineIndexAt(lines, t + song.offset);
    if (idx === state.current && !force) return;
    state.current = idx;
    [...box.children].forEach((el, i) => {
      el.classList.toggle('past', i < idx);
      el.classList.toggle('now', i === idx);
      el.classList.toggle('next', i === idx + 1);
    });
    const el = box.children[Math.max(0, idx)];
    if (el) {
      scroller.scrollTo({
        top: el.offsetTop - scroller.clientHeight * 0.4 + el.offsetHeight / 2,
        behavior: force ? 'auto' : 'smooth',
      });
    }
  }

  // 싱크 가사의 i번째 줄 시간으로 이동 (멈춰 있으면 멈춘 채로)
  function seekTo(i) {
    i = Math.min(lines.length - 1, Math.max(0, i));
    const t = Math.max(0, lines[i].time - song.offset + 0.001);
    if (follow.listener) follow.follower.jump(t, sec());
    state.elapsed = t;
    state.startedAt = performance.now();
    syncLine();
  }

  function step(dir) {
    if (timed) return seekTo(state.current + dir);
    const dy = dir * scroller.clientHeight * 0.3;
    if (state.running) {
      state.pos = Math.min(maxScroll(), Math.max(0, state.pos + dy));
      scroller.scrollTop = state.pos;
      state.lastSet = scroller.scrollTop;
    } else {
      scroller.scrollBy({ top: dy, behavior: 'smooth' });
    }
  }

  function restart() {
    setRunning(false);
    state.elapsed = 0;
    follow.follower = null;
    $('p-toggle').textContent = '▶ 시작';
    scroller.scrollTop = 0;
    if (timed) syncLine(true);
  }

  function adjust(act) {
    switch (act) {
      case 'slower': song.speed = Math.max(1, song.speed - 1); break;
      case 'faster': song.speed = Math.min(30, song.speed + 1); break;
      case 'later': song.offset = Number((song.offset - 0.25).toFixed(2)); break;
      case 'earlier': song.offset = Number((song.offset + 0.25).toFixed(2)); break;
      case 'smaller': changeFontSize(-4); break;
      case 'bigger': changeFontSize(4); break;
      case 'restart': return restart();
      case 'fullscreen': return toggleFullscreen();
      case 'follow': return toggleFollow();
      default: return;
    }
    saveDb();
    showValues();
    if (timed) syncLine(act === 'smaller' || act === 'bigger');
  }

  function showValues() {
    $('p-speed').textContent = `속도 ${song.speed}`;
    const o = song.offset;
    $('p-offset').textContent = o === 0 ? '싱크 ±0' : `${Math.abs(o)}초 ${o > 0 ? '빨리' : '늦게'}`;
  }

  // 재생 중엔 3초 뒤 버튼을 숨기고, 화면을 건드리면 다시 보여준다
  let idleTimer;
  function poke() {
    controls.classList.remove('hide');
    stage.classList.remove('idle');
    clearTimeout(idleTimer);
    if (state.running) {
      idleTimer = setTimeout(() => {
        controls.classList.add('hide');
        stage.classList.add('idle');
      }, 3000);
    }
  }

  const ac = new AbortController();
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: ac.signal });
  let tapWhileHidden = false;

  on($('p-toggle'), 'click', () => setRunning(!state.running));
  on(controls, 'click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) adjust(btn.dataset.act);
    poke();
  });
  on(stage, 'pointerdown', () => {
    tapWhileHidden = controls.classList.contains('hide');
    poke();
  });
  on(stage, 'mousemove', poke);
  // 버튼이 숨어 있을 때 첫 탭은 버튼만 보여주고, 그다음부터 줄을 누르면 그 줄로 이동
  on(box, 'click', (e) => {
    const line = e.target.closest('.line');
    if (timed && line && !tapWhileHidden) seekTo(Number(line.dataset.i));
  });
  on(window, 'resize', () => timed && syncLine(true));
  on(document, 'keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const keys = {
      ' ': () => setRunning(!state.running),
      Enter: () => setRunning(!state.running),
      ArrowRight: () => step(1),
      ArrowDown: () => step(1),
      PageDown: () => step(1),
      ArrowLeft: () => step(-1),
      ArrowUp: () => step(-1),
      PageUp: () => step(-1),
      '-': () => adjust(timed ? 'later' : 'slower'),
      '=': () => adjust(timed ? 'earlier' : 'faster'),
      '+': () => adjust(timed ? 'earlier' : 'faster'),
      Escape: () => (location.hash = '#/'),
    };
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    document.activeElement?.blur?.(); // 포커스된 버튼이 스페이스로 한 번 더 눌리지 않게
    if (!e.repeat || e.key.startsWith('Arrow') || e.key.startsWith('Page')) fn();
    poke();
  });

  showValues();
  showFollow();
  $('p-toggle').textContent = '▶ 시작';
  if (timed) syncLine(true);
  poke();

  return () => {
    ac.abort();
    setRunning(false);
    clearTimeout(idleTimer);
    controls.classList.remove('hide');
    stage.classList.remove('idle');
    status.hidden = true;
  };
}

function timedLine(l, i) {
  const p = document.createElement('p');
  p.className = l.text ? 'line' : 'line instrumental';
  p.textContent = l.text || '♪ ♪ ♪';
  p.dataset.i = i;
  return p;
}

function plainLines(text) {
  return text.split(/\r?\n/).map((l) => {
    const p = document.createElement('p');
    p.className = l.trim() ? 'line' : 'gap';
    p.textContent = l.trim();
    return p;
  });
}

// ── 싱크: 음악에 맞춰 줄마다 탭해서 LRC 만들기 + 따라가기용 음악 기억하기 ──
// 유튜브가 있으면 영상 시간이 기준(되감아도 안 어긋남), 없으면 ‘시작’ 누른 뒤 흐른 시간.
function showSync(song) {
  const texts = lyricLines(song.text);
  if (texts.length === 0) {
    toast('가사가 비어 있어');
    location.hash = `#/edit/${song.id}`;
    return null;
  }
  document.title = `${song.title} 싱크`;
  applyFontSize();
  $('s-title').textContent = song.title;

  const ytId = song.youtube ?? null;
  const timedAlready = isLrc(song.text);
  const video = $('s-video');
  const learnBox = $('s-learn');
  const source = $('s-source');
  let mode = timedAlready && !song.ref ? 'learn' : 'tap'; // tap: 줄 시간 찍기, learn: 음악만 기억

  const marks = []; // 줄마다 시작 시간(초)
  const learned = []; // 기억한 크로마, 칸 번호 = 시간 / HOP
  let learnedCount = 0;
  let player = null;
  let ytFailed = !ytId;
  let started = false;
  let starting = false;
  let startedAt = 0;
  let listener = null;
  let raf = 0;
  const clock = () => (player ? player.getCurrentTime() : started ? (performance.now() - startedAt) / 1000 : 0);
  const playing = () => (player ? player.getPlayerState() === PLAYING : started);

  const ac = new AbortController();
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: ac.signal });

  video.hidden = !ytId;
  if (ytId) {
    video.replaceChildren(hint('유튜브 불러오는 중…'));
    const failed = (msg) => {
      player = null;
      ytFailed = true;
      video.replaceChildren(hint(msg));
      render();
    };
    createPlayer(video, ytId, {
      onState: () => render(),
      onError: (kind) =>
        failed(
          kind === 'blocked'
            ? '이 영상은 주인이 다른 사이트 재생을 막아놨어. 같은 곡의 다른 영상(가사 영상·라이브 등) 링크로 바꾸거나, 음악을 따로 틀고 시작해.'
            : '이 영상을 재생할 수 없어. 음악을 따로 틀고 시작해.',
        ),
    })
      .then((p) => {
        if (ac.signal.aborted) return p.destroy();
        if (ytFailed) return;
        player = p;
        render();
      })
      .catch(() => failed('유튜브를 불러오지 못했어. 음악을 따로 틀고 시작해.'));
  }

  const tabOk = !!ytId && canCaptureTab();
  source.querySelector('[value=tab]').disabled = !tabOk;
  source.value = tabOk ? 'tab' : 'mic';
  learnBox.checked = !!ytId || mode === 'learn';

  function render() {
    const tapping = mode === 'tap';
    const i = marks.length;
    const done = tapping && i >= texts.length;
    const waitingVideo = ytId && !player && !ytFailed;

    $('s-mode').hidden = !timedAlready || started;
    for (const b of $('s-mode').children) b.classList.toggle('on', b.dataset.mode === mode);
    if (!tapping) learnBox.checked = true;
    learnBox.disabled = started || !tapping;
    source.disabled = started || !learnBox.checked;
    $('s-learned').textContent = learnedCount
      ? `기억한 음악 ${formatTime(learnedCount * HOP, false)}${player ? ` / ${formatTime(player.getDuration(), false)}` : ''}`
      : '';

    if (tapping) {
      $('s-prev').textContent = texts[i - 1] ?? '';
      $('s-now').textContent = done ? '끝! 저장해' : texts[i];
      $('s-next').textContent = texts[i + 1] ?? '';
    } else {
      $('s-prev').textContent = '';
      $('s-now').textContent = started ? '음악 기억하는 중 ♪' : '음악만 기억하기';
      $('s-next').textContent = '곡 끝까지 틀어 두면 무대에서 마이크로 듣고 따라가';
    }

    const tapBtn = $('s-tap');
    tapBtn.textContent = !started
      ? starting ? '준비 중…' : '시작'
      : tapping ? (done ? '완료' : '탭') : player ? (playing() ? '❚❚ 멈춤' : '▶ 계속') : '기억 중';
    tapBtn.disabled = starting || waitingVideo || done || (!tapping && started && !player);
    $('s-undo').hidden = !tapping;
    $('s-undo').disabled = marks.length === 0;
    $('s-save').disabled = !(tapping ? done : learnedCount * HOP >= 10);

    $('s-hint').textContent = !started
      ? waitingVideo
        ? '영상 준비 중…'
        : tapping
          ? player
            ? '‘시작’을 누르면 영상이 재생돼. 노란 줄을 부르기 시작할 때마다 화면이나 스페이스바를 탭해.'
            : '음악 재생을 누르는 순간 ‘시작’ → 노란 줄을 부르기 시작할 때마다 화면이나 스페이스바를 탭해.'
          : player
            ? '‘시작’을 누르면 영상이 재생되면서 음악을 기억해.'
            : '음악 재생을 누르는 순간 ‘시작’. 가사 시간이 이 기준이라 같이 눌러야 해.'
      : tapping
        ? done
          ? `${texts.length}줄 다 찍었어. ${learnBox.checked ? '음악을 끝까지 기억시키려면 영상이 끝난 뒤 ' : ''}저장해.`
          : `${i + 1} / ${texts.length}줄 · 잘못 눌렀으면 ‘한 줄 취소’(⌫)${player ? ' — 영상도 앞 줄로 돌아가' : ''}`
        : '영상이 끝나면 저장해. 중간에 멈추거나 되감아도 괜찮아.';
  }

  function tick() {
    $('s-clock').textContent = formatTime(clock());
    raf = requestAnimationFrame(tick);
  }

  async function start() {
    if (started || starting || (ytId && !player && !ytFailed)) return;
    if (learnBox.checked) {
      starting = true;
      render();
      const ctx = new AudioContext(); // await 전에 만들어야 아이패드에서 소리가 켜진다
      try {
        const stream = source.value === 'tab' ? await openTabAudio() : await openMic();
        if (ac.signal.aborted) {
          stream.getTracks().forEach((t) => t.stop());
          return ctx.close();
        }
        listener = listen(ctx, stream, learnFrame);
      } catch (e) {
        ctx.close().catch(() => {});
        starting = false;
        render();
        toast(
          e.message === 'no-audio'
            ? '탭 소리가 안 넘어왔어. 공유 창에서 ‘탭 오디오도 공유’를 켜줘'
            : '소리를 받을 수 없어. 권한을 확인하거나 기억하기를 끄고 해줘',
        );
        return;
      }
      starting = false;
    }
    started = true;
    if (player) player.playVideo();
    else startedAt = performance.now();
    render();
  }

  // 재생 중인 동안 들리는 소리를 영상 시간 칸에 적는다(되감으면 덮어씀)
  function learnFrame(chroma, level) {
    if (!playing()) return;
    const j = Math.round(clock() / HOP);
    if (j < 0 || j > (20 * 60) / HOP) return;
    if (learned[j] === undefined) learnedCount++;
    learned[j] = level >= -55 ? chroma : null;
    if (j % 10 === 0) render();
  }

  function tap() {
    if (!started || mode !== 'tap' || marks.length >= texts.length) return;
    const t = clock();
    if (marks.length && t <= marks.at(-1)) return toast('영상이 앞 줄보다 앞이야. 앞으로 가서 눌러줘');
    marks.push(t);
    const pad = $('s-pad');
    pad.classList.remove('flash');
    void pad.offsetWidth;
    pad.classList.add('flash');
    render();
  }

  function undo() {
    if (!marks.length) return;
    marks.pop();
    player?.seekTo(Math.max(0, (marks.at(-1) ?? 0) - 1), true);
    render();
  }

  function save() {
    if (mode === 'tap') {
      song.text = toLrc(texts.map((text, i) => ({ time: marks[i], text })));
      song.offset = 0;
    }
    const remembered = learnedCount * HOP >= 10;
    if (remembered) {
      const frames = Array.from({ length: learned.length }, (_, j) => learned[j] ?? null);
      song.ref = { hop: HOP, frames: encodeFrames(fillGaps(frames)) };
      song.follow = true;
    }
    song.updatedAt = Date.now();
    saveDb();
    toast(
      song.ref
        ? '저장했어. 무대에서 🎤 따라가기가 켜져 있으면 마이크로 듣고 따라가'
        : '싱크 저장했어. 무대에선 음악 재생과 같이 ‘시작’ 눌러',
    );
    location.hash = `#/play/${song.id}`;
  }

  // 손을 뗄 때(click)보다 닿는 순간(pointerdown)이 더 정확하다. 시작만은 click(소리 권한 때문)
  on($('s-pad'), 'pointerdown', tap);
  on($('s-tap'), 'pointerdown', (e) => {
    if (!started || mode !== 'tap') return;
    e.preventDefault();
    tap();
  });
  on($('s-tap'), 'click', () => {
    if (!started) start();
    else if (mode === 'learn' && player) playing() ? player.pauseVideo() : player.playVideo();
  });
  on($('s-undo'), 'click', undo);
  on($('s-save'), 'click', save);
  on($('s-mode'), 'click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b && !started) {
      mode = b.dataset.mode;
      render();
    }
  });
  on(learnBox, 'change', render);
  on(document, 'keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('select')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      document.activeElement?.blur?.();
      if (e.repeat) return;
      if (!started) start();
      else if (mode === 'tap') tap();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      location.hash = '#/';
    }
  });

  render();
  tick();
  return () => {
    ac.abort();
    cancelAnimationFrame(raf);
    listener?.stop();
    player?.destroy();
    video.replaceChildren();
  };
}

// ── 시작 ──
applyFontSize();
window.addEventListener('hashchange', route);
route();
