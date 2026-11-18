/**
 * 2026-11 D 묶음에서 더한 실제 차트 연습 유형. makeCourseQuestion() 이 주제 이름으로 여기서 함수를 찾는다.
 * 각 함수는 (ctx, i, q, h) 를 받아 문제 q 를 채워 돌려주거나, 출제할 수 없으면 null 을 돌려준다.
 * h 는 chart-course.js 가 넘기는 도우미(n, price, num, choose, read)다.
 * 모든 함수는 i 뒤의 봉을 읽지 않는다.
 */
import { buildTrendline } from './trendline.js';
import { buildSrLevel } from './sr-level.js';
import { buildMtf } from './mtf.js';
import { buildBreakoutVolume, buildRetest } from './breakout.js';
import { buildDivergence } from './divergence.js';
import { buildCandleContext } from './candle-context.js';

export const TOPIC_BUILDERS = {
  trendline: buildTrendline,
  'sr-level': buildSrLevel,
  retest: buildRetest,
  mtf: buildMtf,
  'breakout-volume': buildBreakoutVolume,
  divergence: buildDivergence,
  'candle-context': buildCandleContext,
};
