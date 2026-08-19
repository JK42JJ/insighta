#!/usr/bin/env bash
#
# Lab 05 — Terraform: 서버를 손이 아니라 코드로 만든다
#
# 목표: '지금 AWS 에 있는 것' 과 '코드가 있어야 한다고 말하는 것' 을
#       terraform 이 어떻게 비교하는지 본다.
#
# 안전: plan 까지만. apply 는 이 스크립트에 없다.
#       plan 은 아무것도 바꾸지 않는다 — 차이만 계산해서 보여 준다.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

lab_title "Lab 05 — Terraform: 서버를 코드로 만든다" \
  "plan 전용. 인프라 변경 없음. 약 6분."

TF="$LAB_REPO/terraform/projects/insighta/environments/prod"

if ! command -v terraform >/dev/null 2>&1; then
  warn "terraform 이 없습니다.  brew install terraform  후 다시 실행하세요."
  exit 1
fi

step "왜 콘솔에서 클릭하지 않는가"
say "AWS 웹 콘솔에서 서버를 만들면 3분이면 된다. 문제는 그 다음이다 —"
say "여섯 달 뒤에 '이 서버가 왜 이 설정이지?' 를 아무도 답할 수 없고,"
say "똑같은 것을 하나 더 만들라고 하면 기억에 의존해야 한다."
say ""
say "Terraform 은 '있어야 할 상태' 를 파일로 적어 둔다. 그 파일이 곧"
say "설명이자 복제 수단이자 변경 이력이다."

step "우리 코드의 구조"
say "modules/ 는 재사용 부품, projects/ 는 그 부품을 조립한 실제 환경이다."
runsh "ls -1 '$LAB_REPO/terraform/modules' | sed 's/^/     modules\/     /'"
runsh "ls -1 '$LAB_REPO/terraform/projects/insighta/environments' | sed 's/^/     environments\/ /'"

step "부품 하나 열어 보기 — k3s 노드"
say "서버 한 대를 만드는 데 필요한 것이 전부 이 안에 있다."
say "무엇을 입력받는지(변수)부터 본다:"
runsh "grep -E '^variable' '$LAB_REPO/terraform/modules/k3s-node/variables.tf' | sed 's/variable \"/     - /; s/\" {//'"
say ""
say "그리고 무엇을 만드는지(리소스):"
runsh "grep -E '^resource' '$LAB_REPO/terraform/modules/k3s-node/main.tf' | sed 's/resource \"/     - /; s/\" \"/  ->  /; s/\" {//'"
note "node_count 라는 변수가 보인다. 이 숫자 하나가 서버 대수를 정한다."
note "지금은 2, 검증 기간이 끝나면 1 로 줄인다. 코드는 그대로다."

step "지금 상태 확인 — init"
say "terraform 은 '지금 AWS 가 이렇더라' 를 상태 파일에 적어 둔다."
say "그 파일은 S3 에 있고, init 은 거기에 연결하는 단계다."
run terraform -chdir="$TF" init -input=false -no-color

step "차이 계산 — plan"
say "plan 은 세 가지를 비교한다: 코드 · 상태파일 · 실제 AWS."
say "그리고 '무엇을 바꿔야 셋이 같아지는가' 를 출력한다. 바꾸지는 않는다."
say ""
say "No changes 가 나오면 코드와 현실이 일치한다는 뜻이다:"
run terraform -chdir="$TF" plan -input=false -no-color -lock=false
warn "만약 변경 항목이 나온다면 그것은 '코드에 없는 손질' 이 AWS 에"
warn "가해졌다는 신호다. 콘솔에서 손으로 바꾼 것이 대표적이다."

step "무엇이 관리되고 있나"
say "상태 파일에 등록된 것들 — 이 목록에 없는 것은 terraform 이 모른다:"
runsh "terraform -chdir='$TF' state list 2>/dev/null | sed 's/^/     /'"

step "apply 는 왜 여기 없는가"
say "plan 은 읽기다. apply 는 쓰기이고, 서버를 지우고 다시 만들 수도 있다."
say "이 실습에서는 다루지 않는다. 실제로 인프라를 바꿀 때의 순서는:"
say ""
say "  1. 코드를 고친다"
say "  2. plan 을 돌려 출력 전체를 읽는다"
say "  3. destroy / replace 가 있으면 멈추고 왜인지 먼저 이해한다"
say "  4. 되돌릴 방법을 정한 뒤에 apply 한다"
warn "3번을 건너뛰면 running 중인 서버가 사라진다. plan 출력에서"
warn "  '# ... must be replaced'  라는 줄을 항상 찾아본다."

done_msg "Lab 05 완료 — 다음: lab06-ansible.sh"
