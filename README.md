# hongseong-auction-report

대한민국 법원경매정보에서 **홍성지원의 건물 경매를 읽기 전용으로 조회**하고, 홍성군·예산군의 주거용 물건만 골라 휴대폰용 GitHub Pages 보고서로 만드는 프로젝트입니다.

기본 실행은 네트워크를 전혀 사용하지 않는 fixture 모드입니다. 실사이트 조회는 `AUCTION_MODE=live`를 명시한 GitHub Actions 또는 `npm run update:live`에서만 시작됩니다.

> 이 보고서는 검색 보조 자료입니다. 입찰 전에는 반드시 법원 원문과 매각물건명세서, 현황조사서, 감정평가서를 직접 확인하세요. 이 프로젝트는 문서를 다운로드해 검증하지 않으므로 보고서에 항상 **“매각물건명세서·현황조사서 미검증”**을 표시합니다.

## 현재 배포

- [공개 모바일 보고서](https://ggs2535.github.io/hongseong-auction-report/)
- [자동 실행 상태](https://github.com/ggs2535/hongseong-auction-report/actions/workflows/update-auction.yml)
- [운영·제작 인수인계 시작점](HANDOFF.md)

2026-07-16 최초 배포는 성공했지만 법원 초기 화면이 GitHub 실행기에서 timeout되어
현재 보고서는 `NETWORK_ERROR`, `complete=false` 경고 상태입니다. 이는 빈 결과를
정상 조회로 오인하지 않기 위한 안전 동작입니다.

### 휴대폰에서 즉시 조회하기

1. [공개 모바일 보고서](https://ggs2535.github.io/hongseong-auction-report/)에서
   **즉시 조회 요청**을 누릅니다.
2. GitHub에 `ggs2535`로 로그인되어 있는지 확인합니다.
3. 제목을 바꾸지 말고 **Submit new issue**를 누릅니다.
4. 자동 수집과 Pages 배포가 끝나면 요청 글에 결과 댓글이 달리고 글이 닫힙니다.
5. 보고서로 돌아와 **최신 결과 확인**을 누릅니다.

공개 Pages에는 GitHub 토큰을 저장하지 않습니다. 정확한 저장소, 소유자, 이슈 작성자,
`[즉시조회]` 제목을 모두 확인한 경우에만 수집 작업이 실행됩니다. 다른 사용자의
요청은 실행되지 않습니다. 법원 사이트 과부하 방지를 위해 최근 실행 후 10분 동안은
재요청을 거부하며, 당일 `BLOCKED`가 기록되거나 법원 요청 중 실행이 비정상
종료되면 같은 날 즉시 재조회하지 않습니다. 실제 법원 호출 직전 시각과 결과는
`data/instant-query-state.json`에 먼저 기록하므로 workflow 실패 후에도 보호가
유지됩니다.

## 무엇을 보장하는가

- 로그인, 입찰, 문서 제출 기능이 없습니다.
- CAPTCHA 우회, 프록시/IP 회전, 차단 회피 기능이 없습니다.
- `BLOCKED` 또는 `data.ipcheck === false`를 발견하면 재시도나 브라우저 fallback 없이 즉시 중단합니다.
- 휴대폰 즉시 조회도 10분 대기시간과 당일 `BLOCKED` 재실행 금지를 적용합니다.
- 법원 호출은 순차 실행하며 각 실제 요청 사이에 3~5초 무작위 간격을 둡니다.
- 목록 검색은 최대 10회, 사건 상세는 하루 최대 5건으로 제한합니다.
- 불완전 조회는 `latest.json`과 history에 남기되 `last-good.json`을 덮어쓰지 않습니다.
- 사라진 물건은 두 번의 연속된 완전 조회에서 원본 고유 ID가 없을 때만 `WITHDRAWN`으로 확정합니다.
- 특이사항은 지정된 원문 필드에서 실제 키워드를 찾은 경우에만 근거 문자열과 함께 표시합니다.

## 로컬에서 먼저 확인하기

Node.js 20 이상이 필요하며 Node.js 22 LTS를 권장합니다.

```bash
npm ci
npm test
npm run update
```

`npm run update`의 기본값은 fixture 모드입니다. 로컬에서
`.fixture-output/public/`을 정적 웹 서버로 열면 모바일 보고서를 볼 수 있습니다.

fixture 검증 결과는 운영 상태를 보호하기 위해 기본적으로
`.fixture-output/data`와 `.fixture-output/public`에 생성됩니다. 저장소에 포함된
`data/`와 `public/`은 초기 예제 snapshot이며, live 결과가 생긴 뒤 fixture 실행이
이를 덮어쓰지 않습니다. 초기 예제 snapshot을 의도적으로 다시 만들 때만 다음을
사용하세요.

```bash
FIXTURE_CANONICAL_OUTPUT=true npm run update
```

PowerShell에서는 먼저
`$env:FIXTURE_CANONICAL_OUTPUT="true"`를 설정한 뒤 `npm run update`를 실행합니다.

실사이트 조회는 정책을 이해한 뒤에만 실행하세요.

```bash
npm run update:live
```

실행 중 차단이 감지되면 같은 IP에서 반복 실행하지 마세요. 이전 정상 보고서가 유지되는지 먼저 확인해야 합니다.

## GitHub에 배포하기: 초보자용 순서

### 1. 저장소 만들기

GitHub에서 `hongseong-auction-report`라는 **공개 저장소**를 만듭니다. README, `.gitignore`, 라이선스 자동 생성 옵션은 선택하지 않아야 현재 파일과 충돌하지 않습니다.

### 2. 코드 올리기

이 폴더에서 다음 명령을 실행합니다. `YOUR_NAME`은 GitHub 사용자명으로 바꾸세요.

```bash
git init
git add .
git commit -m "feat: initialize hongseong auction report"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/hongseong-auction-report.git
git push -u origin main
```

### 3. Actions 쓰기 권한 켜기

저장소의 **Settings → Actions → General → Workflow permissions**에서 **Read and write permissions**를 선택하고 저장합니다. 이 권한은 생성된 `data/`와 `public/`만 자동 커밋하는 데 사용됩니다.

### 4. Pages 배포 방식을 Actions로 선택하기

**Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다.

### 5. 첫 수동 실행하기

**Actions → Update auction report → Run workflow**를 누릅니다. 순서는 의존성 설치, 테스트, Chromium 설치, live 조회, 결과 커밋, Pages 배포입니다.

첫 live 수집이 `complete=true`로 끝나면 `data/last-good.json`의 `source.mode`가 `live`로 바뀝니다. fixture 예제와 live 데이터는 비교하거나 섞지 않습니다.

배포 후에는 보고서의 **즉시 조회 요청**을 이용할 수 있습니다. 이 기능은 소유자가
만든 `[즉시조회]` 이슈의 `opened` 이벤트만 허용합니다.

### 6. 휴대폰에서 열기

배포가 끝나면 **Settings → Pages**에 표시되는 주소를 엽니다. 일반적으로 다음 형식입니다.

```text
https://YOUR_NAME.github.io/hongseong-auction-report/
```

### 7. 홈 화면에 추가하기

- iPhone Safari: 공유 버튼 → **홈 화면에 추가**
- Android Chrome: 메뉴 → **홈 화면에 추가** 또는 **앱 설치**

PWA service worker가 마지막 정상 보고서를 포함한 화면을 캐시합니다. 네트워크가 없을 때는 캐시된 화면을 표시합니다.

### 8. 장애 확인하기

Actions 실행 페이지 상단의 **Summary**에서 다음 값을 확인합니다.

- 전체조회 완료 여부
- 차단 감지 여부
- 오류 코드, HTTP 상태, 원본 경로와 메시지
- 원본 전체 건수와 고유 확인 건수
- 확인 페이지 수와 미확인 건수
- 마지막 정상 전체조회 시각

원본 JSON은 `data/latest.json`입니다. `complete=false`인데 화면을 정상 조회처럼 해석하면 안 됩니다.

법원 검색 화면 warmup이 HTTP 5xx이면 검색 POST와 Playwright fallback을 실행하지
않습니다. 30초 뒤 한 번만 다시 확인하며, 계속 5xx이면 불완전 보고서에 정확한
HTTP 상태를 남기고 종료합니다. 서버 장애를 우회하려고 반복 실행하지 마세요.

일반 검색 POST가 HTTP 400 또는 네트워크 오류로 실패하면 Playwright fallback은
같은 JSON을 합성 전송하지 않습니다. 공식 물건상세검색 화면에서 `전체`·`홍성지원`·
`건물`을 선택하고 검색 버튼과 페이지 번호를 실제로 조작합니다. 성공한 WebSquare
응답만 정규화하며, 요청 조건이나 페이지 번호가 다르면 재시도 없이 incomplete로
종료합니다.

### 9. 법원 사이트가 차단했을 때

다음 원칙을 지킵니다.

1. 수동 재실행을 반복하지 않습니다.
2. 프록시, IP 회전, CAPTCHA 우회 기능을 추가하지 않습니다.
3. `data/last-good.json`이 변경되지 않았는지 확인합니다.
4. 화면의 붉은 경고와 미확인 건수를 확인합니다.
5. GitHub-hosted runner가 지속적으로 차단될 때만 Cloud Run으로 **한 번의 운영 이전**을 검토합니다.

플랫폼을 옮기는 것은 차단 회피를 보장하지 않습니다.

### 10. Cloud Run으로 옮기기

[Cloud Run Job 이전 안내](docs/cloud-run.md)를 따르세요. Docker 이미지는 GitHub Actions와 같은 수집기를 실행합니다. Cloud Run 파일시스템은 휘발성이므로 GCS 상태 볼륨과 Pages 게시 연결을 반드시 함께 구성해야 합니다.

## 자동 실행

`.github/workflows/update-auction.yml`은 매일 `09:37 UTC`, 즉 한국시간 `18:37`에 실행됩니다. 정각 혼잡을 피하도록 분을 어긋나게 했습니다. 중복 실행은 concurrency 설정으로 막습니다.

예약 실행은 GitHub 사정으로 지연되거나 누락될 수 있습니다. 공개 저장소에서 60일 동안 활동이 없으면 예약 workflow가 비활성화될 수도 있으므로 Actions 화면을 정기적으로 확인하세요.

## 보고서 데이터

| 파일 | 의미 |
| --- | --- |
| `data/latest.json` | 가장 최근 실행 결과. incomplete도 저장 |
| `data/last-good.json` | 가장 최근 `complete=true` 결과만 저장 |
| `data/history/YYYY-MM-DD.json` | 한국시간 날짜별 실행 결과 |
| `public/index.html` | 오늘 상태와 표시용 last-good을 내장한 Pages 문서 |

같은 날 수동으로 여러 번 실행하면 그 날짜의 history 파일은 마지막 실행으로 교체됩니다.

완전 조회 조건은 다음을 모두 만족해야 합니다.

- 차단과 최종 페이지 오류가 없음
- 확인 페이지 수와 예상 페이지 수가 같음
- 고유 수집 건수와 원본 `totalCount`가 같음
- 미확인 건수가 0

첫 페이지 전에 차단되면 전체·미확인 건수를 알 수 없으므로 JSON은 `null`, 화면은 `산정 불가`로 표시합니다.

## 필터와 변경점

주소에 `홍성군` 또는 `예산군`이 있어야 합니다. 주소를 판정할 수 없으면 메인 목록이 아니라 수동 확인 목록으로 보냅니다. 주거 키워드와 제외 키워드가 함께 있는 복합용도 건물도 자동 포함하지 않습니다.

전일 비교 결과는 다음 값 중 하나 이상입니다.

`NEW`, `PRICE_DOWN`, `PRICE_UP`, `FAILED_BID_INCREMENT`, `SALE_DATE_CHANGED`, `STATUS_CHANGED`, `RESTARTED`, `WITHDRAWN`, `DETAIL_UPDATED`

`WITHDRAWN`은 필터 후 목록이 아니라 필터 전 원본 ID 집합의 2회 연속 부재로 판단합니다. incomplete 실행은 부재 횟수를 늘리거나 초기화하지 않습니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `AUCTION_MODE` | `fixture` | `fixture` 또는 `live` |
| `MIN_DELAY_MS` | `3000` | live 최소 요청 간격. 3000 미만 금지 |
| `JITTER_MS` | `2000` | 무작위 추가 간격. live에서 2000 미만 금지 |
| `TIMEOUT_MS` | `30000` | 요청 제한 시간 |
| `RETRY_DELAY_MS` | `30000` | 일반 페이지 오류의 단 한 번 재시도 전 대기 |
| `MAX_LIST_CALLS` | `10` | 목록 전송 호출 상한. 10 초과 금지 |
| `MAX_DETAIL_CALLS` | `5` | 상세 조회 상한 |
| `DATA_DIR` | `./data` | 상태 JSON 경로 |
| `PUBLIC_DIR` | `./public` | 정적 보고서 출력 경로 |
| `STORAGE_WRITE_MODE` | `atomic` | 로컬은 `atomic`, GCS FUSE는 `direct` |
| `FIXTURE_CANONICAL_OUTPUT` | `false` | `true`일 때만 fixture가 운영 `data/public` 경로에 씀 |

`fallbackOnBlocked`는 환경 변수로 열어 두지 않았으며 코드에서 항상 `false`입니다.

## 개발과 유지보수

```bash
npm test
npm run test:coverage
npm run check
npm run update:fixture
```

의존성은 정확한 버전으로 잠겨 있습니다. `playwright`, `playwright-core`, Docker 이미지 태그를 항상 같은 버전으로 올려야 합니다. 정책상 `rebrowser-playwright`는 설치하지 않으며 `.npmrc`가 optional 의존성을 제외합니다.

다른 컴퓨터나 다른 Codex에게 넘길 때는 [유지보수 인수인계서](docs/maintenance-handoff.md)를 먼저 읽게 하세요. 이 문서에 설계 결정, 안전 불변식, 파일 지도, 검증 순서, 알려진 제약을 정리했습니다.

## 알려진 한계

- fixture로 기능을 검증하지만 저장소 제작 과정에서는 법원 실사이트 요청을 실행하지 않았습니다.
- 법원 또는 `court-auction-notice-search` 응답 형식이 바뀌면 live adapter 보정이 필요할 수 있습니다.
- 패키지는 매각물건명세서·현황조사서·감정평가서 다운로드를 제공하지 않습니다.
- 검색목록에서 사라졌다는 사실만으로 실제 취하와 매각을 구분할 수 없어 보고서는 보수적으로 `WITHDRAWN`이라 표시합니다.
- 첫 live 정상 실행 전의 fixture 보고서는 예제이며 실제 경매정보가 아닙니다.

## 라이선스

MIT. 법원 데이터의 이용 조건과 원문 고지는 별도로 준수해야 합니다.
