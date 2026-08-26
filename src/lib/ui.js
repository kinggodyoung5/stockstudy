/** 작은 DOM 헬퍼들 (프레임워크 없이 쓰기 위한 최소 도구) */

/**
 * el('div.foo', { onclick }, ['텍스트', childNode])
 */
export function el(spec, props = null, children = []) {
  const [tagPart, ...classes] = String(spec).split('.');
  const node = document.createElement(tagPart || 'div');
  if (classes.length) node.className = classes.join(' ');

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
  }

  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 지표 on/off 토글 바 */
export function overlayBar(state, onChange, keys) {
  const LABELS = {
    ma5: ['5일선', '#f2b134'],
    ma20: ['20일선', '#4dd0a7'],
    ma60: ['60일선', '#a98bff'],
    bollinger: ['볼린저밴드', '#5b8def'],
    ichimoku: ['일목균형표', '#4dd0a7'],
    volume: ['거래량', '#8b95a9'],
  };
  const bar = el('div.row');
  for (const key of keys || Object.keys(LABELS)) {
    const [label, color] = LABELS[key];
    const input = el('input', { type: 'checkbox', checked: !!state[key] });
    input.addEventListener('change', () => {
      state[key] = input.checked;
      onChange({ ...state });
    });
    bar.append(
      el('label.toggle', null, [input, el('span.swatch', { style: { background: color } }), label])
    );
  }
  return bar;
}

/** 숫자 보기 좋게 */
export function fmt(v, currency) {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  // 액면분할 소급 조정으로 과거 주가가 $1 미만인 종목이 있어, 작은 값은 자릿수를 더 보여준다
  if (currency === 'USD') {
    const digits = Math.abs(v) < 10 ? 4 : 2;
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: digits });
  }
  if (Math.abs(v) >= 10000) return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

export function signed(v) {
  if (v == null) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}

/** 등락 색 클래스 */
export const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'muted');
