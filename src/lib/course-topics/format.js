/** 교재 문제 문구에 쓰는 숫자·위치 표기. */
export const n = (v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
export const sign = (v) => v > 0 ? '위' : v < 0 ? '아래' : '같은 위치';
export const body = (c) => Math.abs(c.close - c.open);
