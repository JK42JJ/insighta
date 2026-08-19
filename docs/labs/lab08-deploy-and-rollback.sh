#!/usr/bin/env bash
#
# Lab 08 — 배포와 롤백
#
# 목표: 코드 한 줄이 운영까지 가는 경로 전체를 따라가 보고,
#       되돌리는 방법이 몇 층으로 준비돼 있는지 각각의 한계까지 확인한다.
#
# 안전: 전부 읽기 전용. 실제 배포도 롤백도 하지 않는다.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_cluster

lab_title "Lab 08 — 배포와 롤백" "읽기 전용. 약 5분."

step "코드가 운영까지 가는 길"
say "  1. 브랜치에서 코드를 고치고 PR 을 연다"
say "  2. CI 가 검사한다 — 타입 · 테스트 · 차트 렌더"
say "  3. main 에 머지된다"
say "  4. 워크플로가 이미지를 만들어 ECR 에 올린다"
say "  5. 클러스터가 그 이미지로 파드를 교체한다"
say ""
say "실제 워크플로 목록:"
runsh "ls -1 '$LAB_REPO/.github/workflows/' | sed 's/^/     /'"

step "무엇이 배포를 유발하나"
say "'머지하면 배포된다' 를 추측하지 말고 트리거 선언을 직접 읽는다:"
runsh "
for f in '$LAB_REPO'/.github/workflows/deploy*.yml; do
  [ -f \"\$f\" ] || continue
  echo \"     \$(basename \$f)\"
  awk '/^on:/{o=1;next} o&&/^[a-z]/{exit} o' \"\$f\" | sed 's/^/       /'
done
"

step "지금 운영에 떠 있는 것"
kshow get deploy -n insighta-prod -o custom-columns='DEPLOY:.metadata.name,READY:.status.readyReplicas,UPDATED:.status.updatedReplicas,IMAGE:.spec.template.spec.containers[0].image' --no-headers

step "교체는 한 번에 일어나지 않는다"
say "파드를 전부 죽이고 새로 만들면 그 사이 서비스가 끊긴다. 그래서"
say "몇 개씩 바꾼다. 그 규칙이 아래에 있다:"
kshow get deploy insighta-api -n insighta-prod -o jsonpath='{.spec.strategy}'
say ""
say "maxUnavailable = 교체 중 없어도 되는 최대 개수"
say "maxSurge       = 교체 중 잠깐 더 띄워도 되는 최대 개수"

step "새 파드가 준비됐는지 무엇으로 판단하나"
say "컨테이너가 떴다고 요청을 받을 준비가 된 것은 아니다. readinessProbe 가"
say "통과해야 서비스가 트래픽을 보낸다. 이것이 무중단 배포의 핵심이다:"
kshow get deploy insighta-api -n insighta-prod -o jsonpath='{.spec.template.spec.containers[0].readinessProbe}'

step "되돌리는 방법 — 1층: 쿠버네티스 리비전"
kshow -n insighta-prod rollout history deploy/insighta-api
say ""
say "명령은  kubectl rollout undo deploy/insighta-api  이다."
say "다만 우리 구성에서는 이것만으로 코드가 돌아가지 않는다. 확인:"
kshow -n insighta-prod get rs -l app.kubernetes.io/component=api \
  -o custom-columns='REPLICASET:.metadata.name,IMAGE:.spec.template.spec.containers[0].image' --no-headers
warn "두 리비전이 같은 이미지 문자열(:latest)을 가리킨다. undo 는 파드를"
warn "새로 만들 뿐 이전 코드로 돌아가지 않는다. Lab 02 에서 본 그 문제다."

step "되돌리는 방법 — 2층: 깃 되돌리기"
say "코드를 되돌리는 커밋을 만들어 머지하면 파이프라인이 다시 돌아 이전"
say "상태의 이미지를 만든다. 느리지만 확실하고, 이력이 남는다."
say ""
say "     git revert <bad-commit>  →  PR  →  머지  →  자동 배포"
note "지금 구성에서 실제로 코드를 되돌리는 유일하게 신뢰할 수 있는 경로다."

step "되돌리는 방법 — 3층: 진입점 되돌리기"
say "배포가 아니라 인프라 자체가 문제일 때 쓴다. 고정 IP(EIP)를 예전"
say "서버에 다시 붙이면 트래픽이 통째로 그쪽으로 간다. 약 2초 걸린다."
say ""
say "지금 고정 IP 가 어디에 붙어 있는지:"
runsh "terraform -chdir='$LAB_REPO/terraform/projects/insighta/environments/prod' state list 2>/dev/null | grep -i eip | sed 's/^/     /'"
warn "이 방법은 예전 서버가 살아 있을 때만 쓸 수 있다. 지금은 EC2 #1 이"
warn "대기 상태로 남아 있어서 가능하지만, 철거하면 이 층은 사라진다."

step "배포 전에 스스로 물어볼 것"
say "  · 되돌릴 좌표가 있는가            — 어느 커밋/이미지로 돌아가나"
say "  · 되돌리는 데 몇 분 걸리는가      — 측정한 값인가 추측인가"
say "  · 데이터도 되돌아가는가           — DB 변경은 대개 되돌아가지 않는다"
say "  · 무엇을 보고 실패를 알아채나     — 어떤 지표, 몇 분 안에"

done_msg "Lab 08 완료 — 다음: lab09-incident-drill.sh"
