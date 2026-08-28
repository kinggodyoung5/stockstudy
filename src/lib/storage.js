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
