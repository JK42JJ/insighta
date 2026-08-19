#!/usr/bin/env bash
#
# Lab 06 — Ansible: 서버 '안' 을 코드로 맞춘다
#
# 목표: terraform 이 서버를 만든 뒤, 그 안의 설정을 누가 맞추는지 본다.
#       --check 모드로 '무엇이 달라질지' 만 확인한다.
#
# 안전: --check --diff 만 사용. 서버를 바꾸지 않는다.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

lab_title "Lab 06 — Ansible: 서버 안을 코드로 맞춘다" \
  "--check 전용. 서버 변경 없음. 약 4분."

ANS="$LAB_REPO/ansible"

step "terraform 과 무엇이 다른가"
say "  terraform  서버라는 '상자' 를 만든다 — 몇 대, 어떤 크기, 어떤 네트워크"
say "  ansible    그 상자 '안' 을 맞춘다 — 패키지 설치, 설정 파일, 서비스 기동"
say ""
say "둘은 경쟁 도구가 아니라 순서다. 상자가 있어야 안을 채운다."

step "우리 ansible 의 구조"
say "역할(role) 하나가 '무엇을 어떻게 설정하는가' 한 묶음이다."
runsh "find '$ANS' -maxdepth 2 -type d -not -name '.*' | sed \"s|$ANS|     ansible|\""

step "nginx 역할이 하는 일"
say "작업 목록을 보면 사람이 손으로 할 일이 그대로 적혀 있다:"
runsh "grep -E '^- name:|^  - name:' '$ANS/roles/nginx/tasks/main.yml' 2>/dev/null | sed 's/.*name: /     - /'"

step "설정 파일은 템플릿이다"
say "고정된 파일이 아니라 변수를 끼워 넣는 틀이다. 그래서 서버가 여러 대여도"
say "같은 템플릿을 쓴다. 틀 안의 변수 자리를 찾아보자:"
runsh "grep -oE '\{\{ *[a-z_]+ *\}\}' '$ANS/roles/nginx/templates/insighta.conf.j2' 2>/dev/null | sort -u | sed 's/^/     /' | head -12"

step "누구에게 적용하나 — 인벤토리"
say "인벤토리는 '어떤 서버가 어떤 그룹에 속하는가' 의 목록이다."
runsh "find '$ANS/inventory' -type f | sed \"s|$ANS|     ansible|\""

if ! command -v ansible-playbook >/dev/null 2>&1; then
  note "ansible 이 설치돼 있지 않아 실제 실행은 건너뜁니다."
  note "설치:  brew install ansible"
  done_msg "Lab 06 완료(부분) — 다음: lab07-argocd.sh"
  exit 0
fi

step "무엇이 달라질지만 본다 — --check --diff"
say "--check 는 '적용한 셈 치고' 돌린다. 바꾸지 않고 차이만 보고한다."
say "--diff 는 파일 내용이 어떻게 달라지는지 줄 단위로 보여 준다."
runsh "ls '$ANS/playbooks/' 2>/dev/null | sed 's/^/     playbook: /'"
note "실제 실행 명령 형태:"
note "  ansible-playbook -i ansible/inventory <playbook>.yml --check --diff"
warn "--check 없이 돌리면 즉시 서버가 바뀐다. 처음에는 항상 --check 부터."

step "changed 가 0 이어야 정상"
say "ansible 은 '이미 그 상태면 아무것도 하지 않는다'(멱등). 그래서 두 번"
say "돌려도 결과가 같다. --check 에서 changed 가 나오면 둘 중 하나다:"
say ""
say "  · 코드를 고쳤는데 아직 서버에 반영하지 않았다  (정상)"
say "  · 누가 서버에서 손으로 고쳤다                  (조사 대상)"

done_msg "Lab 06 완료 — 다음: lab07-argocd.sh"
