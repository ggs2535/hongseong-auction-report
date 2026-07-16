# Codex 인수인계 시작점

이 저장소를 다른 컴퓨터나 다른 Codex가 이어받는 경우 다음 순서로 시작합니다.

## 현재 운영 상태 (2026-07-16)

- GitHub 저장소: <https://github.com/ggs2535/hongseong-auction-report>
- 공개 보고서: <https://ggs2535.github.io/hongseong-auction-report/>
- 자동 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/workflows/update-auction.yml>
- 예약 시각: 매일 18:37 KST (`37 9 * * *`)
- 최초 배포 성공 실행: <https://github.com/ggs2535/hongseong-auction-report/actions/runs/29503452625>

최초 운영 실행에서는 테스트, Chromium 설치, 수집 프로그램, 결과 커밋, Pages 배포가
모두 성공했습니다. 다만 GitHub 호스팅 실행기에서 법원 초기 화면 탐색이 30초 안에
끝나지 않아 최신 보고서는 `NETWORK_ERROR`와 `complete=false`로 기록되었습니다.
현재 공개 화면에 불완전 수집 경고가 보이는 것은 의도한 안전 동작이며, 이를 0건의
정상 조회로 바꾸거나 `last-good`으로 저장하면 안 됩니다. 다음 예약 실행에서
네트워크가 회복되면 자동으로 다시 수집합니다. 같은 오류가 반복되면
[`docs/cloud-run.md`](docs/cloud-run.md)의 이전 절차를 검토합니다.

`.npmrc`의 `omit=optional` 정책 때문에 npm이 `playwright` 실행 바로가기를 만들지
않을 수 있습니다. `npx playwright ...` 대신
`node node_modules/playwright/cli.js ...`를 사용합니다.

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
