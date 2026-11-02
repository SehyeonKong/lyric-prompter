import { isLrc, parseLrc, lineIndexAt, formatTime, toLrc, lyricLines } from './lrc.js';

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
  toastTimer = setTimeout(() => (el.hidden = true), 2500);
}

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

function songItem(s) {
  const timed = isLrc(s.text);
  const li = document.createElement('li');
  const play = Object.assign(document.createElement('a'), { className: 'song', href: `#/play/${s.id}` });
  play.append(
    Object.assign(document.createElement('span'), { className: 'title', textContent: s.title }),
    Object.assign(document.createElement('span'), {
      className: timed ? 'badge sync' : 'badge',
      textContent: timed ? '싱크' : '스크롤',
    }),
  );
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
  $('f-text').value = song?.text ?? '';
  $('f-delete').hidden = !song;
  updateMode();
  if (!song) $('f-title').focus();
}

function updateMode() {
  const text = $('f-text').value;
  $('f-mode').textContent = !text.trim()
    ? ''
    : isLrc(text)
      ? `싱크 가사 (${parseLrc(text).length}줄) — ‘시작’을 음악 재생과 같이 누르면 시간에 맞춰 줄이 강조돼.`
      : '일반 가사 — 자동 스크롤로 올라가. ‘탭으로 싱크 만들기’로 시간을 붙일 수도 있어.';
}

$('f-text').addEventListener('input', updateMode);

function commitEdit() {
  const title = $('f-title').value.trim();
  const text = $('f-text').value.replace(/\s+$/, '');
  if (!title) return toast('제목을 적어줘'), null;
  if (!text.trim()) return toast('가사를 붙여넣어줘'), null;
  if (editing) {
    Object.assign(editing, { title, text, updatedAt: Date.now() });
  } else {
    editing = { id: newId(), title, text, speed: 4, offset: 0, updatedAt: Date.now() };
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

// ── 무대: 싱크 가사는 시간에 맞춰 강조, 일반 가사는 자동 스크롤 ──
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
  const timed = isLrc(song.text);
  const lines = timed ? parseLrc(song.text) : [];

  box.className = timed ? 'lines timed' : 'lines';
  box.replaceChildren(...(timed ? lines.map(timedLine) : plainLines(song.text)));
  scroller.scrollTop = 0;
  $('p-title').textContent = song.title;
  $('p-clock').hidden = !timed;
  $('g-offset').hidden = !timed;
  $('g-speed').hidden = timed;
  $('p-fs').hidden = !fullscreenSupported();

  const state = { running: false, elapsed: 0, startedAt: 0, pos: 0, lastSet: 0, lastFrame: 0, current: -2, raf: 0 };
  const now = () => (state.running ? state.elapsed + (performance.now() - state.startedAt) / 1000 : state.elapsed);
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
    }
    state.running = on;
    $('p-toggle').textContent = on ? '❚❚ 멈춤' : state.elapsed > 0 ? '▶ 계속' : '▶ 시작';
    poke();
  }

  function frame(t) {
    if (timed) {
      syncLine();
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
    state.elapsed = Math.max(0, lines[i].time - song.offset + 0.001);
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
  $('p-toggle').textContent = '▶ 시작';
  if (timed) syncLine(true);
  poke();

  return () => {
    ac.abort();
    setRunning(false);
    clearTimeout(idleTimer);
    controls.classList.remove('hide');
    stage.classList.remove('idle');
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

// ── 탭 싱크: 음악에 맞춰 줄마다 탭해서 LRC 만들기 ──
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
  $('s-clock').textContent = formatTime(0);

  const marks = []; // 줄마다 시작 시간(초)
  let startedAt = null;
  let raf = 0;
  const elapsed = () => (performance.now() - startedAt) / 1000;

  function tick() {
    $('s-clock').textContent = formatTime(elapsed());
    raf = marks.length < texts.length ? requestAnimationFrame(tick) : 0;
  }

  function render() {
    const i = marks.length; // 다음에 탭할 줄
    const done = i >= texts.length;
    $('s-prev').textContent = texts[i - 1] ?? '';
    $('s-now').textContent = done ? '끝! 저장해' : texts[i];
    $('s-next').textContent = texts[i + 1] ?? '';
    $('s-tap').textContent = startedAt === null ? '시작' : done ? '완료' : '탭';
    $('s-tap').disabled = done;
    $('s-undo').disabled = marks.length === 0;
    $('s-save').disabled = !done;
    $('s-hint').textContent =
      startedAt === null
        ? '음악 재생을 누르는 순간 ‘시작’ → 노란 줄을 부르기 시작할 때마다 화면이나 스페이스바를 탭해.'
        : done
          ? `${texts.length}줄 다 찍었어. 저장하면 지금 가사가 이 시간으로 바뀌어.`
          : `${i + 1} / ${texts.length}줄 · 잘못 눌렀으면 ‘한 줄 취소’(⌫)`;
  }

  function tap() {
    if (startedAt === null) {
      startedAt = performance.now();
      tick();
    } else if (marks.length < texts.length) {
      marks.push(elapsed());
      const pad = $('s-pad');
      pad.classList.remove('flash');
      void pad.offsetWidth;
      pad.classList.add('flash');
    }
    render();
  }

  function undo() {
    if (!marks.length) return;
    marks.pop();
    if (!raf) tick();
    render();
  }

  const ac = new AbortController();
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: ac.signal });
  // 손을 뗄 때(click)보다 닿는 순간(pointerdown)이 더 정확하다
  on($('s-pad'), 'pointerdown', tap);
  on($('s-tap'), 'pointerdown', (e) => {
    e.preventDefault();
    tap();
  });
  on($('s-undo'), 'click', undo);
  on($('s-save'), 'click', () => {
    song.text = toLrc(texts.map((text, i) => ({ time: marks[i], text })));
    song.offset = 0;
    song.updatedAt = Date.now();
    saveDb();
    toast('싱크 저장했어. 무대에선 음악 재생과 같이 ‘시작’ 눌러');
    location.hash = `#/play/${song.id}`;
  });
  on(document, 'keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      document.activeElement?.blur?.();
      if (!e.repeat) tap();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      location.hash = '#/';
    }
  });

  render();
  return () => {
    ac.abort();
    cancelAnimationFrame(raf);
  };
}

// ── 시작 ──
applyFontSize();
window.addEventListener('hashchange', route);
route();
