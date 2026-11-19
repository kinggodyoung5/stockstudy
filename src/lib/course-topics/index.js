/**
 * 실제 차트 연습의 주제별 문제 함수. makeCourseQuestion() 이 주제 이름으로 여기서 함수를 찾는다.
 * 각 함수는 (ctx, i, q, tools) 를 받아 문제 q 를 채워 돌려주거나, 출제할 수 없으면 null 을 돌려준다.
 * tools 는 chart-course.js 가 넘기는 도우미(n, price, num, choose, read)다.
 * 모든 함수는 i 뒤의 봉을 읽지 않는다.
 */
import { buildCandle, buildWick, buildTimeframe } from './basics.js';
import { buildTrend, buildLevel } from './structure.js';
import { buildMaPosition, buildMaSlope, buildMaSettings, buildCrossStatus } from './moving-average.js';
import { buildVolume, buildVolumeRule, buildAtr, buildBands } from './volume.js';
import { buildRsi, buildMacd } from './momentum.js';
import { buildTrendline } from './trendline.js';
import { buildSrLevel } from './sr-level.js';
import { buildMtf } from './mtf.js';
import { buildBreakoutVolume, buildRetest } from './breakout.js';
import { buildDivergence } from './divergence.js';
import { buildCandleContext } from './candle-context.js';
import { buildEngulf } from './engulf.js';
import { buildIntegrated, buildLimits } from './analysis.js';
import { buildDouble } from './double.js';

export const TOPIC_BUILDERS = {
  candle: buildCandle, wick: buildWick, timeframe: buildTimeframe,
  trend: buildTrend, level: buildLevel,
  'ma-position': buildMaPosition, 'ma-slope': buildMaSlope, 'ma-settings': buildMaSettings, 'cross-status': buildCrossStatus,
  volume: buildVolume, 'volume-rule': buildVolumeRule, atr: buildAtr, bands: buildBands,
  rsi: buildRsi, macd: buildMacd,
  trendline: buildTrendline, 'sr-level': buildSrLevel, retest: buildRetest, double: buildDouble,
  mtf: buildMtf, 'breakout-volume': buildBreakoutVolume, divergence: buildDivergence, 'candle-context': buildCandleContext, engulf: buildEngulf,
  integrated: buildIntegrated, limits: buildLimits,
};
