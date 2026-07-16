# 유지보수 인수인계서

이 문서는 프로젝트를 다른 컴퓨터로 옮기거나 다른 Codex/개발자가 이어받을 때 가장 먼저 읽는 문서입니다.

## 1. 현재 완성 상태

- 프로젝트: `hongseong-auction-report`
- 기준일: 2026-07-17
- 런타임: Node.js 20 이상, 권장 22 LTS
- 수집 패키지: `court-auction-notice-search@0.3.0`
- 브라우저: `playwright@1.60.0`, `playwright-core@1.60.0`
- 테스트: Node 내장 test runner
- 기본 모드: 네트워크를 사용하지 않는 fixture
- 운영 모드: GitHub Actions 또는 Cloud Run Job의 `AUCTION_MODE=live`
- GitHub 저장소: <https://github.com/ggs2535/hongseong-auction-report>
- GitHub Pages: <https://ggs2535.github.io/hongseong-auction-report/>
- 운영 workflow: <https://github.com/ggs2535/hongseong-auction-report/actions/workflows/update-auction.yml>

2026-07-16 최초 운영 실행은 workflow와 Pages 배포까지 성공했습니다. 법원 초기 화면
탐색은 GitHub 호스팅 실행기에서 30초 timeout이 발생해 `NETWORK_ERROR`,
`complete=false`로 안전하게 저장되었습니다.

같은 날 즉시 조회 기능을 PR #1로 배포한 뒤 이슈 #2와 #4로 실동작을 검증했습니다.
소유자 gate, 테스트, durable 예약, live 수집, 결과 커밋, Pages 배포, 결과 댓글과
이슈 자동 종료가 모두 성공했습니다. 두 실행 모두 법원코드는 확인했지만 첫 목록
요청 전 `UPSTREAM_ERROR`, `complete=false`였습니다. 공식 PGJ151 화면은
2026-07-17 00:25 KST에 HTTP 200, 00:35와 00:40에는 HTTP 500이었고, 회복된 XML의
endpoint와 데이터맵은 설치 패키지의 계약과 일치했습니다. 회사 네트워크나 요청
형식 변경보다 법원 서비스의 간헐적 HTTP 500 장애가 원인이라는 증거가 우세합니다.

PR #5는 `errorStatusCode`, `upstreamUrl`, `upstreamMessage`를 보고서·Actions·
휴대폰 UI와 댓글에 보존합니다. PR #6은 warmup GET 5xx에서 POST와 Playwright를
실행하지 않고 30초 뒤 한 번만 재확인합니다. 공식 F01 화면의 필수 조건과 맞추기
위해 PR #8에서 KST 오늘부터 14일 뒤까지의 검색기간을 추가했습니다. 날짜 보완
후에도 POST 400이어서 PR #9로 JSON 오류 메시지를 보존했고, 최종 실행에서 법원은
“사용에 불편을 드려서 죄송합니다. 잠시 후 다시 이용해 주십시오.”라는 공통 장애
안내를 반환했습니다. 01:16 KST 공식 PGJ151 화면도 HTTP 500이었습니다.

이 변경까지 전체 69개 테스트가 통과했습니다. 공개 Pages는 HTTP 200이며 HTTP 400,
원본 경로와 법원 안내 메시지가 표시됩니다. live `last-good`은 아직 없습니다.
불완전 결과를 0건의 정상 결과로 승격하거나 수동 조회를 반복하지 말고 다음 예약
실행을 관찰합니다.

- 기능 PR: <https://github.com/ggs2535/hongseong-auction-report/pull/1>
- 검증 이슈: <https://github.com/ggs2535/hongseong-auction-report/issues/2>
- 검증 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/runs/29508963985>
- 반복 검증: <https://github.com/ggs2535/hongseong-auction-report/issues/4>
- 진단 보완: <https://github.com/ggs2535/hongseong-auction-report/pull/5>
- 500 조기중단: <https://github.com/ggs2535/hongseong-auction-report/pull/6>
- 필수 검색기간: <https://github.com/ggs2535/hongseong-auction-report/pull/8>
- 오류 메시지 보존: <https://github.com/ggs2535/hongseong-auction-report/pull/9>
- 최종 원인 확인: <https://github.com/ggs2535/hongseong-auction-report/actions/runs/29514619310>

## 2. 새 컴퓨터에서 재개하는 순서

1. 저장소를 복사하거나 clone합니다.
2. Node.js 22와 Git을 설치합니다.
3. 프로젝트 루트에서 `npm ci`를 실행합니다.
4. `npm ls playwright playwright-core rebrowser-playwright`를 실행합니다.
5. Playwright와 core가 모두 `1.60.0`, `rebrowser-playwright`가 비어 있는지 확인합니다.
6. `npm test`를 실행합니다.
7. `npm run update:fixture`를 실행합니다.
8. `.fixture-output/data/latest.json`의 `complete=true`, `missingCount=0`을 확인합니다.
9. `git diff -- data public`가 비어 있어 fixture가 운영 snapshot을 건드리지 않았는지 봅니다.
10. live 운영 전 GitHub Actions 권한과 Pages 설정을 확인합니다.
11. 휴대폰의 즉시 조회 링크는 `ggs2535`로 로그인한 상태에서만 사용합니다.

다른 Codex에게는 다음 요청으로 시작하면 됩니다.

> `docs/maintenance-handoff.md`와 README를 먼저 읽고, npm ci → npm test → fixture update 순서로 현재 상태를 검증하라. 안전 불변식을 변경하지 말고, live 호출은 내가 명시적으로 요청하기 전에는 수행하지 마라.

## 3. 절대 깨면 안 되는 안전 불변식

1. 공개 정보를 읽기 전용으로만 조회합니다.
2. 로그인, 입찰, 문서 제출을 구현하지 않습니다.
3. CAPTCHA 우회, proxy/IP 회전, fingerprint 회피를 추가하지 않습니다.
4. 모든 법원 요청은 순차 실행합니다.
5. 실제 요청 시작 사이에 3~5초 무작위 간격을 둡니다.
6. `BLOCKED`와 `ipcheck=false`는 일반 오류보다 먼저 판정합니다.
7. 차단 시 retry와 Playwright fallback을 모두 금지합니다.
8. `fallbackOnBlocked`는 항상 `false`입니다.
9. 목록 실제 전송 상한은 10회, 상세는 5회입니다.
10. incomplete 실행은 `last-good.json`을 절대 덮어쓰지 않습니다.
11. incomplete 실행은 withdrawal 부재 횟수를 변경하지 않습니다.
12. 특이사항은 원문 근거가 있을 때만 생성합니다.
13. 보고서에서 문서 미검증 고지를 제거하지 않습니다.
14. 즉시 조회는 저장소·actor·triggering actor·이슈 작성자·OWNER 관계·정확한 제목을 모두 확인합니다.
15. 즉시 조회의 10분 대기시간을 줄이거나 당일 `BLOCKED` 금지를 우회하지 않습니다.
16. GitHub 토큰을 HTML, JavaScript, service worker, localStorage에 저장하지 않습니다.
17. `data/instant-query-state.json`은 실제 호출 전에 커밋하며, 손상 시 fail-closed합니다.
18. 승인되지 않은 issue workflow는 정상 수집과 다른 concurrency 그룹으로 격리합니다.
19. 법원 warmup GET이 HTTP 5xx이면 검색 POST나 Playwright fallback으로 확대하지 않습니다.

## 4. 파일 지도

| 파일 | 책임 |
| --- | --- |
| `src/index.js` | 전체 실행 조정, 상세 캐시, diff, 저장, 렌더 |
| `src/court-client.js` | fixture/live source, 속도 제한, fallback, 차단, pagination |
| `src/pagination.js` | 페이지 수, ID, 중복, 누락 계산 |
| `src/residential-filter.js` | 지역·주거·제외·복합용도 판정 |
| `src/special-remarks.js` | 키워드와 원문 evidence 추출 |
| `src/normalize.js` | 패키지 응답을 보고서 item schema로 정규화 |
| `src/diff.js` | 가격/유찰/상태 변경과 2회 부재 상태 전이 |
| `src/storage.js` | latest/history/last-good 저장 규칙 |
| `src/render.js` | self-contained HTML과 PWA cache 버전 생성 |
| `public/app.js` | 필터, 정렬, table/card 렌더, 복사 |
| `src/actions-summary.js` | Actions summary 생성 |
| `src/instant-query-policy.js` | 즉시 조회 10분 대기와 당일 BLOCKED 재실행 금지 |
| `src/instant-query-state.js` | 실제 호출 전 durable 예약과 complete/blocked/incomplete 결과 기록 |
| `data/instant-query-state.json` | workflow 실패·취소 후에도 남는 조회 안전 상태 |
| `.github/workflows/update-auction.yml` | 테스트, live 갱신, 커밋, Pages 배포 |
| `fixtures/` | 네트워크 없는 개발 시나리오 |
| `.fixture-output/` | git에서 제외되는 fixture 전용 상태와 보고서 |
| `test/` | 요구사항 회귀 테스트 |
| `docs/cloud-run.md` | Cloud Run/GCS/Scheduler 이전 |

## 5. 실행 흐름

```text
동적 법원코드 조회
  → 홍성지원 name/branchName 검색
  → 건물 page 1 조회
  → totalCount/pageSize 검증
  → 최대 10회 안에서 페이지 순차 조회
  → 사건번호+물건번호 중복 제거
  → 완전성 계산
  → 홍성군·예산군 및 주거용 필터
  → 신규/목록변경 최대 5건 상세 보충
  → 원문 특이사항/evidence 추출
  → last-good과 diff
  → 원본 ID 기준 withdrawal 상태 전이
  → latest/history 저장
  → complete일 때만 last-good 저장
  → 오늘 상태 + last-good 본문으로 public 생성
```

일반 상세 조회 실패는 목록 완전성을 바꾸지 않고 `detailSummary`와 물건의
`detailStatus`에만 남깁니다. 단, `BLOCKED`는 전역 안전 정책이 우선하므로 전체
보고서를 incomplete/blocked로 전환하고 `last-good`을 보존합니다. 목록이 이미
incomplete이면 불필요한 추가 호출을 피하기 위해 상세 조회를 시작하지 않습니다.

## 6. live 패키지 API 가정

0.3.0 설치 파일을 직접 확인한 결과를 기준으로 합니다.

- `getCourtCodes({ client })` → `{ count, items[] }`
- court item → `{ code, name, branchName }`
- `searchProperties({ courtCode, usage:{large:"건물"}, page, pageSize:100, includeRaw, client, fallback, fallbackOnBlocked })`
- search response → `{ page:{pageNo,pageSize,totalCount}, count, items[] }`
- `getCaseByCaseNumber({ courtCode, caseNumber, includeRaw, client })`
- `CourtAuctionHttpClient` 옵션 → `timeoutMs`, `minDelayMs`, `jitterMs`, `maxCallsPerSession`, `fetchImpl`
- `CourtAuctionPlaywrightClient`는 표준 `playwright-core`를 사용

패키지 자체의 자동 fallback은 HTTP 400만 대상으로 하므로 프로젝트 wrapper가 `fallback:false`로 호출한 뒤 일반 HTTP 400 또는 `NETWORK_ERROR`에만 표준 Playwright를 한 번 사용합니다. `BLOCKED`에는 절대 사용하지 않습니다.

패키지가 응답 필드나 오류 코드를 바꾸면 가장 먼저 `src/court-client.js`와 fixture를 함께 수정합니다.

## 7. 데이터 계약

루트 report 주요 필드:

- `schemaVersion`
- `reportDate`, `generatedAt`, `timezone`
- `source.mode`, `source.courtCode`, `source.searchUrl`
- `completeness`
- `summary`
- `items`
- `reviewItems`
- `withdrawnItems`
- `sourceItemIds`
- `withdrawalCandidates`
- `detailSummary`

`completeness.complete=true` 조건:

- 첫 페이지 count metadata가 유효
- 차단 없음
- 최종 실패 page 없음
- 호출 상한으로 빠진 page 없음
- `fetchedPages === expectedPages`
- `fetchedUniqueCount === totalCount`
- `missingCount === 0`

첫 페이지 이전 실패는 `countsKnown=false`, `totalCount=null`, `missingCount=null`입니다. 0건으로 거짓 표시하면 안 됩니다.

## 8. withdrawal 상태 전이

`withdrawalCandidates[id]`가 부재 횟수와 snapshot을 보존합니다.

- 첫 complete 부재: `consecutiveCompleteMisses=1`
- 다음 complete에도 부재: 2가 되어 `WITHDRAWN` 1회 생성
- incomplete: state 그대로 유지
- 원본에 재등장: state 제거, 현재 item에 `RESTARTED`
- 필터에서만 사라지고 원본 ID가 존재: withdrawal 아님
- 이미 confirmed인 채 계속 부재: `WITHDRAWN` 반복 생성 안 함

이 로직을 바꿀 때는 반드시 두 번 부재, 중간 incomplete, 재등장, 필터 이동 테스트를 함께 수정합니다.

## 9. 필터와 특이사항 주의점

- 주소가 비거나 군 단위 판정이 안 되면 review입니다.
- 대상 외 지역은 제외입니다.
- 주거와 제외 키워드가 함께 나오면 `MIXED_USE` review입니다.
- 단독 `주상복합`은 자동 포함하지 않고 주거부분 문맥이 있어야 합니다.
- 한 글자 토지 키워드 `전`, `답`은 독립 token일 때만 제외합니다. `전세권`, `답사`를 오탐하면 안 됩니다.
- raw 객체는 중첩 문자열 leaf까지 순회하지만 순환 객체는 WeakSet으로 차단합니다.
- evidence는 `{ keyword, field, sourceText }`이며 keyword/field/text 조합으로 중복 제거합니다.
- `remarks=[]`일 때 “특이사항 없음”을 만들지 않습니다. UI에서만 “검색목록상 별도 특이사항 미표시”라고 씁니다.

## 10. 의존성 업그레이드 절차

Playwright는 세 곳을 동시에 맞춥니다.

1. `package.json`의 `playwright`
2. `package.json`의 `playwright-core`
3. `Dockerfile`의 `mcr.microsoft.com/playwright:vX.Y.Z-noble`

그 후:

```bash
npm install
npm ls playwright playwright-core rebrowser-playwright
node node_modules/playwright/cli.js install chromium
npm test
npm run update:fixture
docker build -t hongseong-auction-report:test .
```

`.npmrc`의 `omit=optional`을 제거하면 court 패키지의 optional `rebrowser-playwright`가 설치될 수 있으므로 제거하지 않습니다.
이 설정에서는 npm의 bin 충돌로 `npx playwright`가 생성되지 않을 수 있으므로
Playwright CLI 파일을 위 명령처럼 직접 실행합니다.

## 11. 장애 진단 순서

1. Actions Summary의 `blocked`, `errorCode`, `errorStatusCode`, 원본 경로와 page 수를 봅니다.
2. `data/latest.json`과 `data/last-good.json`의 `generatedAt`을 비교합니다.
3. incomplete인데 last-good이 바뀌었다면 즉시 저장 로직 회귀로 취급합니다.
4. `COURT_NOT_FOUND`이면 court response fixture와 live name/branchName을 확인합니다. 코드를 하드코딩하지 않습니다.
5. `INVALID_PAGE_META`이면 패키지 normalize response를 확인합니다.
6. `CALL_LIMIT`이면 억지로 상한을 늘리지 말고 incomplete를 유지합니다.
7. `BLOCKED`이면 반복 실행하지 않습니다.
8. UI 문제는 `public/index.html` 내장 JSON과 `public/app.js`를 분리해 확인합니다.
9. 즉시 조회가 시작되지 않으면 이슈 제목이 정확히 `[즉시조회]`인지, 작성자와 로그인 계정이 `ggs2535`인지 확인합니다.
10. 즉시 조회 이슈의 자동 댓글에서 대기시간 또는 당일 차단 거부 사유를 확인합니다.
11. `UPSTREAM_ERROR`·HTTP 5xx와 함께 공식 `/pgj/index.on`도 5xx이면 클라이언트
    요청을 반복하거나 상한을 늘리지 말고 법원 서비스 회복을 기다립니다. warmup
    보호가 POST와 브라우저 fallback을 건너뛰는지 확인합니다.
12. HTTP 400의 `upstreamMessage`가 “사용에 불편을 드려서 죄송합니다”와 같은 공통
    안내이고 공식 화면도 5xx이면 요청 body를 다시 추측 수정하지 않습니다.
13. 공식 M01/F01 XML과 `buildPropertySearchBody`의 endpoint, data map, pgmId,
    KST 14일 검색기간을 비교한 뒤 구체적인 필드 오류가 있을 때만 계약을 수정합니다.
14. 사용 중인 `court-auction-notice-search@0.3.0`보다 새 버전이 있더라도 changelog와
    전송 코드를 먼저 비교합니다. 2026-07-16 기준 최신 0.3.2는 공용 브라우저 런타임
    통합 변경이며 검색 endpoint/body 오류 수정은 아니므로 무조건 올리지 않았습니다.

## 12. 테스트 승인 기준

최소 다음이 모두 통과해야 배포할 수 있습니다.

```bash
npm ci
npm test
npm run update:fixture
npm run check
```

추가 수동 확인:

- `public/index.html`에 전체/확인/미확인 통계가 존재
- 720px 이하 카드 CSS 존재
- incomplete 경고 문구 네 줄 존재
- fixture 결과에 홍성군·예산군이 모두 표시
- fixture 실행 뒤 운영 `data/public` diff가 없음
- mixed-use와 주소 미상은 review
- last-good이 incomplete 실행에서 byte-for-byte 유지
- workflow YAML parser 통과
- 외부 사용자·fork·유사 제목의 즉시 조회 workflow가 gate에서 skipped
- 즉시 조회 10분 대기와 당일 BLOCKED 재실행 금지
- 실제 호출 전 durable 예약 커밋과 비정상 종료 후 당일 재조회 금지
- complete/blocked/incomplete 결과 댓글이 서로 구분됨
- 공개 HTML/JS/service worker에 GitHub 토큰이 없음
- `npm ls`에 rebrowser가 없음

## 13. 알려진 제약과 다음 유지보수 후보

- 아직 `complete=true`인 첫 live 응답을 얻지 못해 실제 정상 field mapping 검증이 남아 있습니다.
- 상세 문서를 다운로드하지 않으므로 문서 검증 상태는 항상 false입니다.
- first-page 이전 차단은 미확인 건수 산정 불가입니다.
- 날짜별 history는 같은 날 재실행을 모두 보존하지 않습니다.
- GitHub 예약은 지연/누락될 수 있고 60일 비활동 시 중지될 수 있습니다.
- GitHub runner IP가 막힐 수 있으나 Cloud Run 이전도 성공 보장이 아닙니다.
- GCS FUSE는 POSIX semantics가 완전하지 않아 direct write와 단일 task를 사용합니다.
- Cloud Run 수집 결과를 Pages에 되돌리는 publish-only workflow는 클라우드 계정 정보가 있어야 완성할 수 있습니다.

다음 작업 우선순위:

1. 법원 서비스 회복 후 첫 `complete=true` live response shape를 민감정보 없이 검증
2. live fixture를 익명화해 회귀 fixture로 추가
3. 저장 테스트에서 incomplete last-good hash 불변을 강화
4. Cloud Run을 실제 사용할 때 WIF 기반 publish-only workflow 추가

## 14. 인수인계 완료 체크리스트

- [ ] 저장소와 이 문서를 새 컴퓨터에서 열었다.
- [ ] Node/npm 버전을 기록했다.
- [ ] `npm ci`가 성공했다.
- [ ] Playwright/core 버전과 rebrowser 부재를 확인했다.
- [ ] 전체 테스트가 통과했다.
- [ ] fixture update가 complete로 끝났다.
- [ ] GitHub Actions/Pages 권한을 확인했다.
- [ ] live 실행 여부를 사용자에게 확인했다.
- [ ] 안전 불변식을 변경하지 않았다.
