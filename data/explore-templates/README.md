# Mandala Chart Goal-Setting Templates

Structured 9x9 mandala goal templates across 9 life domains.

## Overview

Each mandala chart entry contains:
- **Center Goal**: The main objective
- **8 Sub-Goals**: Supporting pillars for the center goal
- **64 Actions**: 8 actionable items per sub-goal (8 x 8 = 64)

This structure follows the **mandalart** technique popularized by Shohei Ohtani.

## Domains (9)

| Slug | KO | EN |
|------|----|----|
| tech | 기술/개발 | Tech/Development |
| learning | 학습/교육 | Learning/Education |
| health | 건강/피트니스 | Health/Fitness |
| business | 비즈니스/커리어 | Business/Career |
| finance | 재테크/투자 | Finance/Investment |
| social | 인간관계/커뮤니티 | Relationships/Community |
| creative | 창작/예술 | Creative/Arts |
| lifestyle | 라이프스타일/여행 | Lifestyle/Travel |
| mind | 마인드/영성 | Mind/Spirituality |

## File Formats

### JSONL (Source of Truth)

```jsonl
{"center_goal":"...","domain":"기술/개발","language":"ko","sub_goals":["..."],"actions":{"sub_goal_1":["action_1",...]},...}
```

### CSV (Kaggle Export)

Flattened format with columns:
```
id, center_goal, domain, language, quality_score,
sub_goal_1, ..., sub_goal_8,
action_1_1, ..., action_1_8, ..., action_8_1, ..., action_8_8
```

## Dataset Stats

| Language | Templates | Version |
|----------|-----------|---------|
| KO | 1,000 | v3.0.0 |
| EN | TBD | — |

## License

CC-BY-4.0
