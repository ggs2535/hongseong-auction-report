# Codex 인수인계 시작점

이 저장소를 다른 컴퓨터나 다른 Codex가 이어받는 경우 다음 순서로 시작합니다.

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
