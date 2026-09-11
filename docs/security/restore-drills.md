# 복원 리허설 기록

목적: 백업이 실제로 복원되는지와 걸리는 시간을 기록으로 증명한다(통제 ICS-DATA-06). 실행 = `scripts/ops/restore-drill.sh`. 주기 = **매월 1일 자동**(`.github/workflows/restore-drill.yml`, 실패 시 이슈) + 백업 경로 변경 시 수동. 자동 실행 결과는 워크플로 요약과 로그 아티팩트(90일)에 남고, 이 표에는 실패 또는 절차 변경이 있을 때만 행을 추가한다.

| # | 날짜 | 백업 | 대상 | 결과 | 소요 | 실행자 |
|---|---|---|---|---|---|---|
| 1 | 2026-09-11 | `db/2026/09/backup_20260910.sql.gz` (1,253,271,766 B) | 로컬 Docker `pgvector/pgvector:pg17`, throwaway DB | **성공** — 108 테이블 행 수 전부 일치(0 mismatch), 임베딩 포함(`mandala_embeddings` 21,049 · `video_chunk_embeddings` 2,641), 복원 후 1,482 MB | 다운로드 226초 + 복원 39초 (전체 약 5분) | CC |
| 2 | 2026-09-11 | `db/2026/09/backup_20260911.sql.gz` | GitHub 러너, `restore-drill.yml` 수동 실행(run 34596114284) | **성공** — 108 테이블 0 mismatch, 1,484 MB. 데이터 관련 오류 0(잔여 41건은 auth 스키마 FK · 역할 · 스키마 부재로 예상된 것) | 다운로드 30초 + 복원 62초 (전체 126초) | 자동 |

## 리허설 1 상세 (2026-09-11)

시도 3회. 앞의 두 번은 실패였고, 그 실패가 이 리허설의 산출물이다.

1. **1차 실패 — 로컬 Supabase Postgres 15 로 복원**: 11 MB 만 들어감. 원인 = 새 DB 에 `vector` 확장이 없어 임베딩 테이블 2개 생성이 실패 → 그 테이블의 COPY 데이터가 SQL 로 해석됨 → psql 이 메모리 부족으로 종료 → 이후 테이블 전부 미복원. 메모리의 기존 기록 "전체 복원은 `mandala_embeddings` 에서 OOM" 은 한계가 아니라 이 절차 결함이었다.
2. **2차 실패 — 전제 SQL 이 서버에 닿지 않음**: 공식 이미지가 initdb 중 서버를 한 번 재시작하는데 첫 ready 신호 직후에 전제 SQL 을 보내 "shutting down" 으로 실패. 두 번째 ready 라인을 기다리도록 수정.
3. **3차 성공**: `CREATE EXTENSION vector WITH SCHEMA public` + Supabase 역할·`auth` 스텁을 먼저 만든 뒤 복원. 39초. 덤프의 COPY 행 수와 복원된 count(*) 를 108 테이블 전부 대조해 불일치 0.

남은 오류는 데이터와 무관한 것들이다: `auth.users` 를 참조하는 FK 21건(백업이 public 스키마만 담아 auth 가 비어 있음), 역할 grant 13건(스텁 역할 생성 순서), `auth` 스키마 정책 6건.

## 발견 사항과 후속

- **백업 범위 = public 스키마만.** Supabase 가 관리하는 `auth`(사용자 계정·세션) 는 우리 백업에 없다. 새 Supabase 프로젝트로 복원하는 시나리오에서는 사용자 신원이 Supabase 자체 백업에 의존한다. Stage 2 에서 `auth.users` 최소 export(id·email·provider·created_at)를 백업 워크플로에 추가할지 결정한다.
- 복원 대상은 **PG17 + pgvector** 여야 한다(`\restrict` 토큰, `public.vector`). 로컬 Supabase(PG15) 는 대상이 될 수 없다.
- RTO(로컬 기준) ≈ 5분. 프로덕션 복원은 Supabase 프로젝트에 대해 같은 전제로 수행하며, 소요는 네트워크에 좌우된다.
