// 유튜브: 링크에서 영상 ID 뽑기(순수 함수) + 앱 안에 플레이어 띄우기

const ID = /^[\w-]{11}$/;

export function parseYouTubeId(input) {
  const s = (input ?? '').trim();
  if (ID.test(s)) return s;
  let url;
  try {
    url = new URL(s.includes('://') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1];
  }
  return id && ID.test(id) ? id : null;
}

let api = null;
function loadApi() {
  api ??= new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      api = null;
      reject(new Error('유튜브를 불러오지 못했어'));
    };
    document.head.append(s);
  });
  return api;
}

// host 안에 플레이어를 만든다. 준비되면 플레이어를 돌려준다.
export async function createPlayer(host, videoId, { onState, onError } = {}) {
  const YT = await loadApi();
  const el = document.createElement('div');
  host.replaceChildren(el);
  return new Promise((resolve) => {
    new YT.Player(el, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: (e) => resolve(e.target),
        onStateChange: (e) => onState?.(e.data),
        // 101·150: 영상 주인이 다른 사이트 재생을 막음
        onError: (e) => onError?.(e.data === 101 || e.data === 150 ? 'blocked' : 'error'),
      },
    });
  });
}

export const PLAYING = 1;

// 영상 제목과 채널 이름
export async function fetchVideoInfo(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const { title, author_name: author } = await res.json();
    return { title, author };
  } catch {
    return null;
  }
}
