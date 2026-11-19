/**
 * 평가 전용 종목 (로드맵 E4). 입문 과정에 나오지 않고 평가에만 나온다.
 * 종목 코드마다 sha256('assessment-holdout|코드') 앞 8자리를 0~1 값으로 바꿔 1/8 미만이면 고른다.
 * 종목 하나의 소속은 그 코드만으로 정해진다. 종목이 늘거나 줄어도 기존 종목의 소속은 바뀌지 않는다.
 * 이후 등락이나 자료 내용은 쓰지 않는다.
 */
import { createHash } from 'node:crypto';

export const HOLDOUT = {
  method: "sha256('assessment-holdout|' + 종목 코드)의 앞 8자리 ÷ 2^32 < 0.125",
  salt: 'assessment-holdout|', share: 0.125,
};

export const holdoutValue = (ticker) => parseInt(createHash('sha256').update(HOLDOUT.salt + ticker).digest('hex').slice(0, 8), 16) / 2 ** 32;
export const isHoldout = (ticker) => holdoutValue(ticker) < HOLDOUT.share;
export const holdoutTickers = (tickers) => tickers.filter(isHoldout).sort();
