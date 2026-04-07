# Mandala Model Evaluation v14 — Qwen3.5-9B & Gemma 4 26B-A4B

> Date: 2026-04-07
> Author: JK + Claude
> Status: Completed — v13 (Qwen3-4B) 유지, Mac Mini 서빙 배포 완료

## 배경

v13 (Qwen3-4B fine-tuned) 성능 부족 우려로 상위 모델 평가 진행.

| 항목 | 값 |
|------|-----|
| 학습 환경 | MBP M4 24GB (MLX LoRA) |
| 서빙 환경 | Mac Mini M4 16GB (Ollama) |
| 데이터셋 | insighta-mandala-sft (train 1801, val 200) |
| 평가 기준 | 5건 zero-shot → sub_goals 8/8, actions 64/64 |

## 모델 비교 결과

### Zero-shot (파인튜닝 없이)

| 모델 | 성공률 | 고유율 | 평균 시간 (MBP) | 모델 크기 | Mac Mini 16GB 서빙 |
|------|--------|--------|----------------|----------|-------------------|
| **v13 (Qwen3-4B fine-tuned)** | **15/15 (100%)** | **97%** | **~33s** | **4.3GB Q8** | **OK** |
| Qwen3.5-9B zero-shot | 3/5 → 5/5 (/no_think) | 97% | ~96s | 6.6GB | OK |
| Gemma 4 26B-A4B zero-shot | 4/5 (80%) | 100% | ~86s | 17GB | 빡빡 |

### Qwen3.5-9B 상세

- 기본 모드 3/5: FAIL 2건은 thinking 토큰에 시간 소진 → 빈 응답
- `/no_think` 모드 5/5: thinking 비활성화 시 전부 PASS
- PASS 시 구조 완벽 (8/8 sub, 64/64 actions)

### Gemma 4 26B-A4B 상세

- 4/5 PASS, 고유율 100% (64/64 unique) — 품질 최고
- FAIL 1건: 빈 응답 (thinking 소진 추정)
- 모델 크기 17GB → Mac Mini 16GB 서빙 사실상 불가

## MLX LoRA 파인튜닝 시도 (MBP 24GB)

### Qwen3.5-9B — OOM 4회 연속 실패

| 시도 | num-layers | batch | max-seq | grad-checkpoint | 결과 |
|------|-----------|-------|---------|-----------------|------|
| 1 | 16 | 1 | - | off | OOM (iter 1) |
| 2 | 8 | 1 | - | on | OOM (iter 1) |
| 3 | 8 | 1 | 2048 | on | OOM (iter 1) |
| 4 | 4 | 1 | 1024 | on | OOM (iter 1) |

- Validation (forward pass)은 매번 성공 (val loss 1.769)
- Training step (backward pass)에서 Metal GPU OOM
- 9B 4-bit 모델의 backward pass 메모리가 24GB 초과

### 결론

24GB MBP에서 9B+ 모델 MLX LoRA 파인튜닝은 **물리적으로 불가**. Cloud GPU (Kaggle T4/A100) 필요.

## Mac Mini 서빙 배포

### 인프라 설정

| 항목 | 값 |
|------|-----|
| Host | james-macmini (Tailscale: 100.91.173.17) |
| SSH | `ssh macmini` (MBP ~/.ssh/config 등록됨) |
| Ollama | v0.20.2 (0.6.2에서 업그레이드, homebrew 서비스 중지 후 수동 실행) |
| 모델 | mandala-gen:latest (v13 Q8, 4.3GB) |
| API | `http://localhost:11434/api/generate` |
| 모델 파일 | `~/models/mandala-gen/mandala-gen-v13-q8.gguf` + `Modelfile` |

### Ollama 업그레이드 이슈

- 기존: Homebrew 설치 Ollama 0.6.2 (launchctl `homebrew.mxcl.ollama`로 자동 시작)
- 문제: 0.6.2가 v13 GGUF 포맷 미지원 (unable to load model)
- 해결: Homebrew 서비스 중지 (`launchctl bootout`) → GitHub releases에서 0.20.2 설치 → 수동 `ollama serve`
- 주의: Mac Mini 재부팅 시 Ollama 자동 시작 미설정 상태

### Mac Mini 서빙 테스트 결과

| # | 목표 | 결과 | sub | act | uniq | 시간 |
|---|------|------|-----|-----|------|------|
| 1 | TOEFL 100점 | WARN | 8/8 | 55/64 | 54 | 145s |
| 2 | Data engineer | FAIL | - | - | - | 304s |
| 3 | 운동 습관 | PASS | 8/8 | 81/64 | 81 | 324s |
| 4 | Side project | PASS | 8/8 | 63/64 | 63 | 63s |
| 5 | 패시브 인컴 | PASS | 8/8 | 63/64 | 63 | 90s |
| **총합** | | **3/5 PASS** | | | | **avg 185s** |

- MBP 대비 ~5.6x 느림 (33s → 185s)
- FAIL/WARN은 JSON 파서 한계 (출력 절단/멀티라인)
- 모델 생성 자체는 정상 (raw 출력에 유효한 JSON 구조 확인됨)

## Q4_K_M 양자화 — 불가 (CP348 확인)

| 양자화 | 성공률 (50건 batch) | 비고 |
|--------|-------------------|------|
| Q8_0 | 43/50 PASS | 기준선 |
| Q4_K_M | 41/50 PASS, 6 FAIL | regression + 속도 저하 |

Q4_K_M은 JSON 구조 유지 능력 저하 + 속도도 느림. **Q8 유지 확정.**

## 미해결 사항 (Devin 위임)

1. **JSON 파서 강화**: 출력 절단/멀티라인 JSON 수리 로직 개선
   - 참고: `mandala-diagnostic-v13-fixed.ipynb`의 `extract_json_robust()`
2. **Ollama 자동 시작**: Mac Mini 재부팅 대비 launchd 설정
3. **프론트엔드 위자드 연동**: API URL을 Mac Mini Ollama로 변경

### Devin 접속 정보

- Tailscale auth key 발급 후 네트워크 참가
- SSH: `jamesjk@100.91.173.17`
- 테스트 스크립트: `/tmp/test_macmini_mandala.py`

## 파일 위치

| 파일 | 위치 | 용도 |
|------|------|------|
| v13 학습 노트북 | `~/Downloads/insighta-mandala-sft-fine-tuning-v13.ipynb` | Kaggle T4, Qwen3-4B LoRA |
| v13 진단 노트북 | `~/Downloads/mandala-diagnostic-v13-fixed.ipynb` | Gemma 4 E2B + robust parser |
| MLX 학습 환경 | `/Volumes/storage/mlx-training/` | venv, data, adapters (미완료) |
| Mac Mini 모델 | `macmini:~/models/mandala-gen/` | GGUF + Modelfile |
| Zero-shot 테스트 | `/Volumes/storage/mlx-training/test_zeroshot_api.py` | Ollama API 기반 5건 테스트 |
| Mac Mini 테스트 | `macmini:/tmp/test_macmini_mandala.py` | Robust parser 5건 테스트 |

## 최종 결론

| 판단 | 근거 |
|------|------|
| **v13 (Qwen3-4B) 유지** | 100% 성공률, 최고 속도 (33s), 안정적 |
| 9B/26B 파인튜닝 불가 | 24GB MBP OOM, Cloud GPU 필요 |
| 9B/26B zero-shot 의미 없음 | v13 대비 느리고 (3-5x), 성공률 동등/이하 |
| Mac Mini 서빙 가능 | Q8 4.3GB, 16GB RAM 여유, 속도 ~3분/건 |
