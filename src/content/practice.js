/** 학습용으로 구성한 수치 예제. 시장 데이터나 수익률 검증 표본이 아니다. */
export function makeCandles(values) {
  return values.map((close, i) => {
    const open = i ? values[i - 1] : close - 1;
    return { date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
      open, close, high: Math.max(open, close) + 2, low: Math.min(open, close) - 2, volume: 1000 + i * 100 };
  });
}

export function buildPractice(variant = 0) {
  const base = 100 + (Math.abs(Math.floor(variant)) % 20) * 10;
  const question = (id, title, lesson, prompt, facts, options, answer, explanation, candles) =>
    ({ id, title, lesson, prompt, facts, options, answer, explanation, candles });
  const shifted = (xs) => xs.map((x) => x + base);
  const trend = makeCandles(shifted([0, 4, 8, 4, 6, 12, 17, 10, 13, 20, 25, 18, 22]));
  return [
    question('candle', '양봉과 전일 등락', 'chart-basics', '마지막 봉을 정확히 설명한 것은?',
      `전일 종가 ${base + 10}, 오늘 시가 ${base}, 고가 ${base + 8}, 저가 ${base - 2}, 종가 ${base + 5}.`,
      ['양봉이고 전일 대비 하락했다.', '양봉이므로 전일 대비 상승했다.', '전일보다 내렸으므로 음봉이다.'], 0,
      '봉의 색은 종가와 시가를 비교합니다. 전일 대비 등락은 오늘 종가와 전일 종가를 비교하므로 두 기준이 다릅니다.',
      [{ date: '2024-01-01', open: base + 7, high: base + 12, low: base + 6, close: base + 10, volume: 1000 },
        { date: '2024-01-02', open: base, high: base + 8, low: base - 2, close: base + 5, volume: 1500 }]),
    question('path', '봉으로 알 수 없는 것', 'chart-basics', '이 봉에서 확인할 수 없는 정보는?',
      `시가 ${base}, 고가 ${base + 10}, 저가 ${base - 5}, 종가 ${base + 8}.`,
      ['고가와 저가의 차이', '종가가 시가보다 높은지', '고가와 저가 중 어느 쪽을 먼저 찍었는지'], 2,
      'OHLC는 네 가격의 요약입니다. 고가와 저가를 방문한 순서, 중간의 왕복 횟수는 분봉이나 체결 기록 없이는 알 수 없습니다.',
      [{ date: '2024-01-01', open: base, high: base + 10, low: base - 5, close: base + 8, volume: 1000 }]),
    question('trend', '가격 구조 읽기', 'structure-basics', '표시된 구간의 고점과 저점 흐름에 가장 가까운 설명은?',
      '전체 13봉의 반복된 굴곡을 비교하세요. 마지막 봉 하나만 보고 판단하지 않습니다.',
      ['고점과 저점이 함께 낮아진다.', '반복된 고점과 저점이 대체로 높아진다.', '앞으로도 반드시 같은 방향으로 간다.'], 1,
      '반복된 반등의 고점과 되돌림 저점이 높아지는 구조입니다. 이는 이 구간의 관찰이며 이후 상승을 보장하지는 않습니다.', trend),
    question('ma', '평균과 현재 가격', 'moving-average', '최근 3봉 단순이동평균과 마지막 종가의 관계는?',
      `최근 3봉 종가: ${base}, ${base + 10}, ${base + 20}.`,
      [`평균은 ${base + 20}이고 종가와 같다.`, `평균은 ${base + 10}이고 종가는 그보다 높다.`, '평균보다 높으므로 다음 봉도 상승한다.'], 1,
      `세 종가의 합을 3으로 나누면 ${base + 10}입니다. 평균 위에 있다는 것은 현재 위치의 설명이지 다음 봉의 정답이 아닙니다.`, makeCandles(shifted([0, 10, 20]))),
    question('timeframe', '봉 단위 확인', 'chart-basics', '월봉 차트에서 MA 기간을 20으로 설정했다면?',
      '한 봉은 한 달입니다. 표시 화면을 확대해도 봉 단위 설정은 바꾸지 않았습니다.',
      ['최근 20거래일 평균이다.', '최근 20개월 봉의 종가 평균이다.', '화면에 보이는 모든 봉의 평균이다.'], 1,
      '기간 숫자는 선택한 봉의 개수입니다. 확대·축소는 표시 범위를 바꾸지만 지표의 계산 기간을 바꾸지 않습니다.'),
    question('level', '돌파와 되돌림', 'structure-basics', '“저항 위 종가 마감”을 돌파 기준으로 정했다면 마지막 봉은?',
      `저항 후보 ${base + 20}. 마지막 봉 고가 ${base + 23}, 종가 ${base + 18}.`,
      ['장중에는 넘었지만 종가 기준 돌파는 아니다.', '고가가 넘었으니 종가 돌파도 확정이다.', '내일 종가를 이미 알 수 있다.'], 0,
      '미리 정한 기준이 종가라면 고가가 선을 넘은 것만으로 조건을 만족하지 않습니다. 장중 돌파와 종가 돌파를 구분해야 합니다.',
      [...makeCandles(shifted([0, 12, 18, 9, 17, 11])), { date: '2024-01-07', open: base + 11, high: base + 23, low: base + 10, close: base + 18, volume: 2000 }]),
    question('rsi', '과매수의 의미', 'rsi', 'RSI(14)가 76일 때 직접 말할 수 있는 것은?',
      '이 앱의 와일더 RSI 계산을 사용했습니다. 다른 가격 정보는 주어지지 않았습니다.',
      ['다음 봉은 하락한다.', '최근 가격 변화가 상승 쪽으로 치우쳐 있다.', '현재 주식의 적정 가치를 넘었다.'], 1,
      'RSI는 상승·하락 폭의 평활 평균을 비교한 지표입니다. 고평가 판정이나 즉시 반전의 보장이 아닙니다.'),
    question('macd', '교차와 0선', 'macd', 'MACD선과 시그널선이 정확히 같아진 시점에 반드시 성립하는 것은?',
      '히스토그램은 MACD선 − 시그널선으로 정의합니다.',
      ['MACD선 자체가 0이다.', '장기 상승 추세가 확정됐다.', '히스토그램 값이 0이다.'], 2,
      '같은 두 값을 빼면 0입니다. 두 선이 만나는 높이는 0 위일 수도 아래일 수도 있습니다. 선 교차와 MACD 자체의 0선 교차는 별개입니다.'),
    question('volume', '거래량과 참여자', 'volume', '직전 20봉 평균 거래량이 1,000주, 오늘이 2,000주라면?',
      '거래된 주식 수만 주어졌으며 계좌별 체결 정보는 없습니다.',
      ['거래량이 비교 평균의 2배다. 참여자 수는 모른다.', '거래한 사람이 2배 늘었다.', '가격도 반드시 2배 올라야 한다.'], 0,
      '동일 참여자의 반복 거래도 거래량에 포함됩니다. 거래량 배수로 참여자의 수나 매수 의도를 확정할 수 없습니다.'),
    question('obv', 'OBV의 변화 읽기', 'obv', '두 날짜 사이 OBV가 증가했다면 알 수 있는 것은?',
      '상승일 거래량은 더하고, 하락일은 빼고, 보합일은 유지하는 OBV입니다.',
      ['하락일 거래량이 매번 줄었다.', '상승일에 더한 거래량 합이 하락일에 뺀 합보다 컸다.', '시작값을 바꾸면 주가 방향도 바뀐다.'], 1,
      'OBV 증가는 구간의 부호 있는 거래량 합이 양수라는 뜻입니다. 하락일 거래량의 감소 추세나 특정 투자자의 매집은 별도 정보가 필요합니다.'),
    question('confirmation', '알 수 있었던 시점', 'structure-basics', '좌우 5봉보다 높은 봉을 고점으로 정할 때, 10번째 봉을 언제 가장 빨리 확정할 수 있나?',
      '봉 번호는 1부터 시작합니다. 10번째 봉을 포함한 모든 비교 가격은 고가입니다.',
      ['10번째 봉 마감', '11번째 봉 시작', '15번째 봉 마감'], 2,
      '오른쪽 11~15번째 봉이 모두 끝나야 조건을 확인할 수 있습니다. 표시는 10번째 봉에 붙어도 당시 이미 알았던 신호가 아닙니다.'),
    question('review', '판단과 결과 분리', 'analysis-process', '상승 시나리오를 적었는데 이후 주가가 내렸습니다. 가장 적절한 복기는?',
      '정답을 보기 전에 관찰한 사실, 조건, 실패 시나리오를 기록해두었습니다.',
      ['내렸으므로 당시 관찰도 전부 틀렸다.', '올랐던 다른 사례만 골라 설명한다.', '당시 근거가 정확했는지와 이후 결과를 따로 검토한다.'], 2,
      '기초 학습은 관찰·해석·한계를 정확히 설명하는 능력을 기릅니다. 예측 한 번의 성공이나 실패로 개념의 타당성이나 분석 능력을 판정하지 않습니다.'),
  ];
}

/** 제출 전에는 답을 바꾸거나 근거를 고칠 수 있다. 제출 뒤에는 한 번만 기록한다. */
export function recordAttempt(previous, { correct, reason, confidence }, now = Date.now()) {
  const old = previous && Number.isInteger(previous.attempts) ? previous : {};
  const streak = correct ? (old.streak || 0) + 1 : 0;
  return {
    attempts: (old.attempts || 0) + 1, correct: (old.correct || 0) + Number(correct),
    lastCorrect: correct, reason: reason.trim().slice(0, 1000), confidence,
    firstCorrect: old.firstCorrect ?? correct, streak, lastAt: now,
    // 복습 안내용 간격이며 숙달 인증 기준이 아니다.
    dueAt: now + (correct ? [1, 3, 7][Math.min(streak - 1, 2)] : 0) * 86400000,
  };
}
