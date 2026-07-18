# Cloud Run Job 이전 안내

GitHub-hosted runner에서 법원 사이트 차단이 반복될 때 동일 수집기를 Cloud Run Job으로 옮기는 절차입니다. 이 이전은 프록시나 IP 회전이 아니며, 성공을 보장하지 않습니다. `BLOCKED`가 나오면 Job을 반복 실행하지 않습니다.

## 먼저 이해할 구조

Cloud Run Job의 로컬 파일은 실행이 끝나면 사라집니다. 따라서 Docker 이미지만 배포하면 `data/last-good.json`과 생성된 Pages가 보존되지 않습니다.

권장 구조는 다음과 같습니다.

1. Cloud Scheduler가 하루 한 번 Cloud Run Job을 실행
2. Job이 비공개 GCS bucket에 마운트된 `/state/data`, `/state/public`을 갱신
3. GitHub의 게시 전용 workflow가 GCS 결과를 가져와 검증
4. `data/`, `public/`만 커밋하고 Pages artifact를 배포

3~4번 연결이 없으면 수집 결과는 GCS에만 있고 GitHub Pages는 갱신되지 않습니다.

## 권장 실행 사양

- tasks: 1
- parallelism: 1
- max retries: 0
- CPU: 1
- memory: 2 GiB
- task timeout: 45분
- Scheduler 재시도: 0

앱이 페이지 오류를 한 번만 재시도하므로 플랫폼 재시도는 끕니다.

## 준비 변수

아래 예시 값을 환경에 맞게 바꿉니다.

```bash
export PROJECT_ID="your-project-id"
export REGION="asia-northeast3"
export AR_REPO="auction-jobs"
export IMAGE="hongseong-auction-report"
export JOB="hongseong-auction-report"
export BUCKET="${PROJECT_ID}-hongseong-auction-state"
export RUNTIME_SA="auction-job@${PROJECT_ID}.iam.gserviceaccount.com"
export SCHEDULER_SA="auction-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud config set project "$PROJECT_ID"
```

Cloud Run, Cloud Build, Artifact Registry, Cloud Scheduler API를 활성화합니다.

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com
```

## 1. 이미지 저장소와 GCS 만들기

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION"

gcloud storage buckets create "gs://$BUCKET" \
  --location="$REGION" \
  --uniform-bucket-level-access
```

초기 상태를 올립니다.

```bash
gcloud storage rsync --recursive data "gs://$BUCKET/data"
gcloud storage rsync --recursive public "gs://$BUCKET/public"
```

fixture `last-good`은 실제 데이터가 아닙니다. Job의 첫 live 성공 후 `source.mode=live`인지 확인하세요. 첫 live 실행이 실패하면 fixture 항목을 실제 결과처럼 게시하지 않습니다.

## 2. 최소 권한 서비스 계정 만들기

```bash
gcloud iam service-accounts create auction-job
gcloud iam service-accounts create auction-scheduler

gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$RUNTIME_SA" \
  --role="roles/storage.objectUser"
```

runtime 계정에는 이 bucket의 객체 권한만 줍니다. 공개 읽기 권한은 필요 없습니다.

## 3. Docker 이미지 빌드

프로젝트 루트에서 실행합니다.

```bash
gcloud builds submit \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/$IMAGE:1.0.0"
```

Dockerfile의 base image, `playwright`, `playwright-core`는 모두 `1.60.0`으로 맞춰져 있습니다. 한쪽만 업그레이드하면 Chromium 실행 파일이 맞지 않을 수 있습니다.

## 4. Cloud Run Job 만들기

```bash
gcloud run jobs create "$JOB" \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/$IMAGE:1.0.0" \
  --region "$REGION" \
  --tasks 1 \
  --parallelism 1 \
  --max-retries 0 \
  --task-timeout 45m \
  --cpu 1 \
  --memory 2Gi \
  --service-account "$RUNTIME_SA" \
  --set-env-vars "AUCTION_MODE=live,DATA_DIR=/state/data,PUBLIC_DIR=/state/public,STORAGE_WRITE_MODE=direct" \
  --add-volume "name=state,type=cloud-storage,bucket=$BUCKET" \
  --add-volume-mount "volume=state,mount-path=/state"
```

GCS FUSE는 완전한 POSIX 파일시스템이 아니므로 `STORAGE_WRITE_MODE=direct`를 사용합니다. Job과 Scheduler 양쪽에서 중복 실행을 만들지 마세요.

먼저 단 한 번 수동 실행합니다.

```bash
gcloud run jobs execute "$JOB" --region "$REGION" --wait
```

실행 후 확인합니다.

```bash
gcloud storage cat "gs://$BUCKET/data/latest.json"
gcloud storage cat "gs://$BUCKET/data/last-good.json"
```

검증 항목:

- `latest.completeness.complete`
- `blocked`
- `errorCode`
- `fetchedPages / expectedPages`
- `fetchedUniqueCount`
- `missingCount`
- 정상일 때만 `last-good` 시각이 바뀌었는지

## 5. Scheduler 만들기

Scheduler 계정에 해당 Job 실행 권한만 부여합니다.

```bash
gcloud run jobs add-iam-policy-binding "$JOB" \
  --region "$REGION" \
  --member="serviceAccount:$SCHEDULER_SA" \
  --role="roles/run.invoker"
```

한국시간 18:37에 실행되도록 설정합니다. Google API인 Cloud Run v2 `:run` 호출에는 OAuth를 사용합니다.

```bash
gcloud scheduler jobs create http "${JOB}-daily" \
  --location "$REGION" \
  --schedule "37 18 * * *" \
  --time-zone "Asia/Seoul" \
  --uri "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$JOB:run" \
  --http-method POST \
  --oauth-service-account-email "$SCHEDULER_SA" \
  --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform" \
  --max-retry-attempts 0
```

Cloud Run Scheduler를 운영에 사용하면 중복 수집을 막기 위해 GitHub Actions의 live
schedule을 비활성화해야 합니다. 프론트엔드 전용 `deploy-pages.yml`의 수동 Pages
게시 기능은 법원 조회를 실행하지 않으므로 남겨도 됩니다.

## 6. GCS 결과를 Pages로 게시하기

장기 GitHub PAT를 Cloud Run에 넣지 않는 방식을 권장합니다.

권장 방식:

1. GitHub Actions에서 Google Workload Identity Federation을 설정
2. 게시 전용 workflow에 GCS 읽기 권한만 부여
3. `gs://BUCKET/data`와 `gs://BUCKET/public`을 checkout 폴더로 동기화
4. `npm ci && npm test` 실행
5. JSON의 schema와 `source.mode=live` 확인
6. `git add -- data public`만 커밋
7. 같은 실행에서 `actions/upload-pages-artifact`와 `actions/deploy-pages` 실행

대안으로 Secret Manager의 GitHub App 토큰 또는 fine-grained PAT로 Job이 push할 수 있지만, 장기 비밀 관리와 권한 범위 때문에 권장하지 않습니다.

## 장애 대응

### BLOCKED

- Job은 incomplete 결과를 저장하고 종료 코드 0으로 끝납니다.
- Scheduler를 수동 반복 실행하지 않습니다.
- `last-good.json`이 바뀌지 않았는지 확인합니다.
- 프록시/IP 회전/우회 기능을 추가하지 않습니다.

### GCS 쓰기 실패

- runtime 서비스 계정의 bucket 한정 `roles/storage.objectUser`를 확인합니다.
- tasks와 parallelism이 1인지 확인합니다.
- `STORAGE_WRITE_MODE=direct`인지 확인합니다.
- 부분 파일이 있다면 마지막 정상 백업으로 복원한 뒤 한 번만 재실행합니다.

### Pages가 안 바뀜

Cloud Run은 Pages를 직접 배포하지 않습니다. 게시 전용 GitHub workflow가 실행됐는지, GCS에서 `public/index.html`을 가져왔는지 확인합니다.

## 공식 문서

- [Cloud Run Job 예약 실행](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)
- [Cloud Run Job의 Cloud Storage volume](https://docs.cloud.google.com/run/docs/configuring/jobs/cloud-storage-volume-mounts)
- [Playwright Docker](https://playwright.dev/docs/docker)
- [GitHub Pages 사용자 지정 workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
