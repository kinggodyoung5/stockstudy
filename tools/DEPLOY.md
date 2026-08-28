# 배포 메모

## GitHub Pages

정적 사이트라 빌드 설정이 필요 없습니다. 저장소 Settings → Pages 에서
**Source: Deploy from a branch / Branch: `main` / Folder: `/ (root)`** 로 두면 끝입니다.

배포 주소: <https://kinggodyoung5.github.io/stockstudy/>

### `.nojekyll` 이 반드시 있어야 합니다

GitHub Pages 는 기본으로 Jekyll 을 돌리는데, Jekyll 은 **밑줄(`_`)로 시작하는 파일과 폴더를
결과물에서 제외**합니다. 이 프로젝트에는 그런 파일이 있습니다.

- `data/patterns/_index.json` — 통계 탭과 첫 화면이 읽는 전체 요약
- `data/stocks/_KS11.json`, `_KQ11.json`, `_GSPC.json`, `_IXIC.json` — 지수 (상대강도용)

저장소 루트의 빈 `.nojekyll` 파일이 Jekyll 처리를 통째로 끕니다. **지우지 마세요.**
지우면 통계 탭과 첫 화면이 404 로 깨지고, 데이터 뷰어의 상대강도 기능이 동작하지 않습니다.

### 경로

- 모든 링크가 상대 경로이고 라우팅이 해시(`#/...`) 기반이라, 서브 경로(`/stockstudy/`)에
  올려도 그대로 동작합니다. SPA 리라이트 설정도 필요 없습니다.
- `src/lib/data.js` 는 `import.meta.url` 기준으로 `data/` 를 찾으므로 배포 위치를 타지 않습니다.

## 용량

`docs/CAPACITY.md` 참고. 요약: 종목당 약 0.13 MB, GitHub Pages 한도는 1 GB.

## Vercel 로 올릴 경우

Framework Preset: **Other**, 빌드 명령 없음, 출력 디렉터리 루트.
Jekyll 을 쓰지 않으므로 `.nojekyll` 이슈는 없습니다.
