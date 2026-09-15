# WO-2026-09-15 Keel standing errors: supply-chain, pipeline-freshness signal, IAM key

Status: in progress (2026-09-15 15:30 KST)

# 목표

Keel 이 09-11 검사 도입 이후 계속 error 로 보고하는 4건 중 CC 가 닫을 수 있는 것을 닫는다.
- supply-chain: 두 lockfile 의 critical/high 를 0 으로.
- pipeline-freshness: `LLM calls` 신호를 informational 로 전환(정책 변경 반영).
- iam-hygiene: 액세스 키 회전(193d). MFA 등록은 James 몫.
- cloud-posture: 구독 확인은 James 몫(jamesjk4242@gmail.com 의 확인 메일, 09-18 13:51 만료).

# 맥락

## 실측 (2026-09-15 15:00 KST)

- supply-chain 는 `npm audit --package-lock-only` 를 두 lockfile 에 실행한 수치. 스크래치 사본에서 non-major `audit fix` 를 실측:
  - frontend: 2C/16H → 1C/1H. 남는 것 = vite ^5.4 (fix ≥ 6.4.3) · vitest 3.2.4 exact pin (fix 3.2.7; 06-01 #822 의 사유였던 vite-node 3.2.5 미공개 문제는 3.2.7 이 vite-node 3.2.4 를 쓰므로 해소). peer 확인: plugin-react-swc 3.11 vite ^4~^7, vite-plugin-pwa 1.2 vite ^3~^7, vitest 3.2.7 vite ^5~^7.
  - frontend CI/Docker 는 lockfile 을 쓰지 않는다(`npm install --no-package-lock`). lockfile 은 로컬 개발과 Keel 감사에만 쓰인다.
  - backend: 1C/13H → 변화 없음. 전부 major: fastify 4.29 → 5.12.4 계열(cors 8→11, helmet 11→13, jwt 7→10, multipart 8→10, rate-limit 9→11, swagger 8→9, swagger-ui 2→6, scalar 1.24→1.68), nodemailer 8→10, sharp 0.34→0.35, @langchain/core 0.3→1.2(runnables 2파일), typescript-eslint 6→8(dev; eslint 8.57.1 충족). 코드 영향 실측: `routerPath` 1곳(src/api/server.ts:228), `reply.code(302).redirect(url)` 4곳(시그니처 호환).
- pipeline-freshness `LLM calls` 26h 임계는 09-08 에 trend-collector 일간 실행을 전제로 잡았다. 09-10 LLM 지출 종료 정책으로 일간 실행이 사라져, 이 신호는 "하루 동안 LLM 기능 사용 없음" 을 뜻한다. 자막 파이프라인(54d)·요약(23d) 이 실제 결함이며 원인은 맥미니의 `collect.ts` 에 스케줄러(launchd/cron) 가 없는 것 — James 결정 대기.
- iam-hygiene: admin 사용자 액세스 키 1개(2026-03-06 생성) = 이 맥의 CLI default 프로필. CI/Keel 은 OIDC(`AWS_ROLE_ARN`). MFA 장치 없음.

# 설계

1. PR-F `chore/frontend-supply-chain`: lockfile non-major fix + vite ^6.4.3 + vitest 3.2.7. 검증 = vitest, tsc(app), vite build, /verify 스모크(8081).
2. PR-B `chore/backend-fastify5-supply-chain`: 위 major 일괄 + fastify 5 마이그레이션 코드 수정 + lockfile 재생성. 검증 = tsc, jest(smoke 포함 app.inject), lint, `server-module-resolution` 테스트. 배포 후 `/health`, `/docs`, 인증 라우트 401 확인.
3. PR-K `chore/keel-llm-signal-informational`: SURFACES 의 llm_call_logs 를 informational 로(나이는 표시, STALE 판정 제외) + 단위 테스트 + 문서.
4. 키 회전: 새 키 생성 → 로컬 default 프로필 갱신 → sts 확인 → 구 키 Inactive(되돌릴 수 있음) → 7일 후 삭제.

# 제약

- 머지는 `scripts/ops/merge-green.sh` 로만(R31). 커밋 메시지 영어.
- 롤백: PR-F/PR-B 는 `charts/insighta/environments/prod.yaml` 태그 복귀(현재 api a7491352 · frontend 64af3999). 키 회전은 구 키 재활성화.
- OrbStack 종료 상태 → 로컬 Docker 빌드 불가. Docker 검증은 deploy.yml 빌드 단계로 대체(빌드 실패 시 핀 없음 = prod 무영향).
- 메일 발송 없음. `.env*` 무변경.

# 검증 기준

- Keel 수동 실행에서 supply-chain `no critical or high vulnerabilities in either lockfile`.
- pipeline-freshness 메시지에 `LLM calls Nh` 가 STALE 없이 표시되고, 자막·요약만 STALE.
- iam-hygiene 메시지에서 `keys over 90d` 사라짐.
- prod: `/health` 200, `/api/v1/brief/c/ai-tech/issues` 401, `/brief/2026-09-02-ai-tech` 렌더.

# James

- SNS 구독 확인 메일 클릭(jamesjk4242@gmail.com). support@ 로 바꾸려면 지시.
- 콘솔 MFA 등록(IAM → admin → Security credentials).
- 맥미니 `collect.ts` 스케줄(계정·cron/launchd) 결정. 12:21 백업 plist 의 평문 프록시 계정 삭제.

# 결과

(진행 중)
