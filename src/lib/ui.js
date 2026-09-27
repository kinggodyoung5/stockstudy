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
    ma5: ['단기 이평', '#f2b134'],
    ma20: ['중기 이평', '#4dd0a7'],
    ma60: ['장기 이평', '#a98bff'],
    ma120: ['120일선', '#5b8def'],
    ma200: ['200일선', '#ff8a3d'],
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

/** 명시 단위를 우선하고 기존 근거 라벨의 비가격 단위를 호환한다. */
const NON_PRICE = /(%|÷|배수|비율|거래일|거래량|횟수|R²|기울기|오차|포인트|RSI|OBV|ADX|[+−-]DI|스토캐스틱|이격도)/i;
export function formatEvidence(e, currency) {
  if (e.value == null) return '—';
  if (typeof e.value !== 'number') return String(e.value);
  if (e.unit ? e.unit !== 'price' : NON_PRICE.test(e.label)) {
    return e.value.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  }
  return fmt(e.value, currency);
}

/** 등락 색 클래스 */
export const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'muted');

/** 통계의 모집단 변경을 눈에 띄게 공개한다. 격리는 가격 정정이나 시장 대표성 인증이 아니다. */
export function qualityNotice(meta) {
  const q = meta?.quality;
  if (!q) return el('span');
  return el('details.rulebox.quality-notice', null, [
    el('summary', { text: `자료 범위: ${q.totalStocks}개 중 ${q.eligibleStocks}개 종목 사용 · ${q.quarantinedStocks}개 격리` }),
    el('p.small', { text: `남은 정합성 오류 ${q.invalidCandles}봉, 미해결 출처·결측 문제 ${q.sourceConcerns || 0}건이 있는 종목은 전체 이력을 학습 사례·통계·기준선에서 제외했습니다. 두 수치는 중복될 수 있습니다. 뷰어에서는 경고와 함께 확인할 수 있습니다.` }),
    el('p.small', { text: `국내 ${q.recovery?.stocks || 0}개 종목을 두 공급자 자료로 대조해 ${q.recovery?.corrections || 0}봉을 복구하고, 확인된 무거래 표시 ${q.recovery?.nonTradingRemoved || 0}봉은 계산용 자료에서 뺐습니다. 복구 전 원본·수집 응답·변경 근거를 별도로 보존했습니다. 실제 거래 기록 전체의 정확성을 인증한 것은 아닙니다.` }),
    el('p.small.muted', { text: '격리로 종목·시장 구성이 달라졌으므로 이전 통계와 승률만 직접 비교하지 마세요. 검사 통과도 원자료 가격이나 분할·배당 조정의 정확성을 인증하지는 않습니다.' }),
    el('p.small.muted', { text: `규칙 ${meta.provenance?.rulesVersion || '미표시'} · 집계 생성 ${meta.generatedAt} · 20거래일 완전 관측만 집계` }),
    el('p.small', { text: '격리 종목 코드: ' + q.excludedTickers.join(', ') }),
  ]);
}
