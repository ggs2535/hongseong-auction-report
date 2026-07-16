# Codex 인수인계 시작점

이 저장소를 다른 컴퓨터나 다른 Codex가 이어받는 경우 다음 순서로 시작합니다.

## 현재 운영 상태 (2026-07-17)

- GitHub 저장소: <https://github.com/ggs2535/hongseong-auction-report>
- 공개 보고서: <https://ggs2535.github.io/hongseong-auction-report/>
- 자동 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/workflows/update-auction.yml>
- 예약 시각: 매일 18:37 KST (`37 9 * * *`)
- 최초 배포 성공 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/runs/29503452625>
- 즉시 조회 기능 PR: <https://github.com/ggs2535/hongseong-auction-report/pull/1>
- 최초 즉시 조회 요청: <https://github.com/ggs2535/hongseong-auction-report/issues/2>
- 최초 즉시 조회 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/runs/29508963985>
- 반복 확인 요청: <https://github.com/ggs2535/hongseong-auction-report/issues/4>
- 반복 확인 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/runs/29510276570>
- 실패 진단 보완 PR: <https://github.com/ggs2535/hongseong-auction-report/pull/5>
- HTTP 500 조기중단 PR: <https://github.com/ggs2535/hongseong-auction-report/pull/6>
- HTTP 진단 배포 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/runs/29512601664>
- 필수 14일 검색기간 PR: <https://github.com/ggs2535/hongseong-auction-report/pull/8>
- 법원 오류 메시지 보존 PR: <https://github.com/ggs2535/hongseong-auction-report/pull/9>
- 최종 원인 확인 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/runs/29514619310>

최초 운영 실행에서는 테스트, Chromium 설치, 수집 프로그램, 결과 커밋, Pages 배포가
모두 성공했습니다. 다만 GitHub 호스팅 실행기에서 법원 초기 화면 탐색이 30초 안에
끝나지 않아 최신 보고서는 `NETWORK_ERROR`와 `complete=false`로 기록되었습니다.
2026-07-16의 최초 실제 즉시 조회에서는 소유자 gate, 61개 테스트, durable 예약,
live 수집, 결과 저장, Pages 배포, 이슈 댓글과 자동 종료가 모두 성공했습니다.
두 즉시 조회 모두 법원코드는 정상 확인했으나 첫 목록 요청 전에
`UPSTREAM_ERROR`, `complete=false`로 끝났습니다. 공식 PGJ151 화면은
2026-07-17 00:25 KST에 HTTP 200으로 회복됐다가 00:35와 00:40에 다시 HTTP 500을
반환했습니다. 회복 시점의 공식 XML에서 endpoint와 데이터맵 계약이 기존 수집기와
같은 것도 확인했습니다. 따라서 현재 증거는 회사 컴퓨터나 요청 형식이 아니라 법원
서비스의 간헐적 HTTP 500 장애를 가리킵니다.

PR #5부터 HTTP 상태, 원본 `/pgj/` 경로, 원본 메시지를 Actions 요약·휴대폰 댓글·
붉은 경고에 보존합니다. PR #6부터 warmup GET이 5xx이면 검색 POST와 Playwright를
실행하지 않고, 기존 정책대로 30초 뒤 한 번만 재확인합니다. 공개 Pages 자체는
HTTP 200이며 즉시 조회와 최신 결과 버튼이 배포되어 있습니다.

공식 M01/F01 XML과 패키지 요청을 비교해 누락됐던 KST 오늘~14일 뒤 검색기간도
PR #8에서 보완했습니다. 그래도 실제 POST는 HTTP 400이었고, PR #9로 안전하게
확보한 법원 JSON 메시지는 “사용에 불편을 드려서 죄송합니다. 잠시 후 다시 이용해
주십시오.”라는 공통 장애 안내였습니다. 특정 필드 오류가 아니며 01:16 KST에도 공식
PGJ151 화면이 HTTP 500이어서 법원 서비스 장애가 최종 원인입니다. 공개 Pages에는
HTTP 400, 원본 경로, 이 메시지가 표시됩니다.

현재 공개 화면에 불완전 수집 경고가 보이는 것은 의도한 안전 동작입니다. 이를 0건의
정상 조회로 바꾸거나 `last-good`으로 저장하면 안 됩니다. 더 이상 수동 조회를
반복하지 말고 법원 서비스가 회복된 뒤 다음 예약 실행 또는 사용자의 새 즉시 조회가
시도하도록 둡니다. 같은 오류가
반복되면 [`docs/cloud-run.md`](docs/cloud-run.md)의 이전 절차를 검토하되, 플랫폼
이동을 차단 회피 수단으로 사용하지 않습니다.

`.npmrc`의 `omit=optional` 정책 때문에 npm이 `playwright` 실행 바로가기를 만들지
않을 수 있습니다. `npx playwright ...` 대신
`node node_modules/playwright/cli.js ...`를 사용합니다.

휴대폰의 **즉시 조회 요청**은 공개 페이지에서 토큰을 사용하지 않습니다.
`ggs2535/hongseong-auction-report`에서 `ggs2535` 소유자가 정확히
`[즉시조회]` 제목으로 새 이슈를 만든 경우에만 workflow gate가 열립니다. 실행 완료
또는 안전 정책 거부 결과는 이슈 댓글에 기록되고 요청 이슈는 자동으로 닫힙니다.
`src/instant-query-policy.js`의 10분 대기와 당일 `BLOCKED` 재실행 금지를 제거하지
마세요. `data/instant-query-state.json`은 실제 호출 전에 원격 저장소에 먼저
커밋되는 durable 안전 상태입니다. 손상되거나 누락되면 즉시 조회를 허용하지 않는
fail-closed 동작을 유지해야 합니다.

1. [전체 유지보수 인수인계서](docs/maintenance-handoff.md)를 끝까지 읽습니다.
2. `npm ci`
3. `npm test`
4. `npm run update:fixture`
5. `.fixture-output/data/latest.json`의 `complete=true`, `missingCount=0`을 확인합니다.
6. live 호출은 사용자가 명시적으로 요청한 경우에만 실행합니다.

fixture 출력은 `.fixture-output/`에 격리되어 운영 `data/`와 `public/`을 덮어쓰지
않습니다. `BLOCKED` 즉시 중단, 요청 직렬화, 3~5초 간격, 호출 상한,
incomplete의 `last-good` 보존 규칙은 변경하지 마세요.

배포 절차는 [README](README.md), Cloud Run 이전은
[docs/cloud-run.md](docs/cloud-run.md)를 따릅니다.
