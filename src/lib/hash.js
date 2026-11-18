/**
 * 결정적 균등값 [0,1). 같은 글자열이면 언제나 같은 값이다.
 * 교재 문제의 문장 종류, 평가 표집, 복습 사례 순서가 같이 쓴다.
 * 계산을 바꾸면 평가 문항과 교재가 전부 달라지므로 고치지 않는다.
 */
export function uniform(text) {
  let h1 = 0xdeadbeef ^ 0x51ed27, h2 = 0x41c6ce57 ^ 0x51ed27;
  for (let k = 0; k < text.length; k++) {
    const ch = text.charCodeAt(k);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) / 2 ** 53;
}
