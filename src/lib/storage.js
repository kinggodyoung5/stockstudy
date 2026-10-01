/**
 * 브라우저 로컬 저장 (localStorage 얇은 래퍼)
 *
 * 시크릿 창·사이트 데이터 차단 환경에서는 읽기/쓰기 자체가 예외를 던진다.
 * 저장이 안 되더라도 앱은 그대로 동작해야 하므로 전부 try/catch 로 감싸고 기본값을 돌려준다.
 */

const PREFIX = 'stockstudy:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false; // 용량 초과·차단 등
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (_) { /* 무시 */ }
}

/** 이 앱이 쓴 키 목록 (접두사 제외) */
export function keys() {
  try {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out.sort();
  } catch (_) {
    return [];
  }
}

/**
 * 여러 키를 한 번에 쓴다. 하나라도 실패하면 이미 쓴 키를 원래 값으로 되돌리고 { ok: false } 를 돌려준다.
 * 가져오기처럼 일부만 바뀌면 기록이 어긋나는 작업에 쓴다. value 가 undefined 면 그 키를 지운다.
 */
export function saveMany(entries) {
  const before = [];
  try {
    for (const [key] of entries) before.push([key, localStorage.getItem(PREFIX + key)]);
    for (const [key, value] of entries) {
      if (value === undefined) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
    return { ok: true };
  } catch (error) {
    try {
      // 먼저 이번에 쓴 값을 모두 지워 공간을 비운 뒤, 원래 값을 다시 쓴다.
      for (const [key] of before) localStorage.removeItem(PREFIX + key);
      for (const [key, raw] of before) if (raw != null) localStorage.setItem(PREFIX + key, raw);
    } catch (_) { /* 되돌리기도 막힌 환경 */ }
    return { ok: false, quota: /quota/i.test(String(error?.name) + String(error?.message)) };
  }
}

/** 저장이 실제로 가능한 환경인지 (안내 문구를 바꾸기 위해) */
export function available() {
  try {
    const k = PREFIX + '__t';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (_) {
    return false;
  }
}
