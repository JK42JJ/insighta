#!/usr/bin/env bash
#
# Lab 01 — 서버 한 대에 들어가 보기
#
# 목표: SSH 가 무엇이고, 우리가 왜 `ssh` 를 직접 치지 않고 스크립트를 쓰는지,
#       그리고 그 서버 위에서 실제로 무엇이 돌고 있는지 눈으로 확인한다.
#
# 안전: 전부 읽기 전용. 서버 상태를 바꾸는 명령은 하나도 없다.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

lab_title "Lab 01 — 서버 한 대에 들어가 보기" \
  "읽기 전용. 약 2분."

step "SSH 란 무엇인가"
say "내 노트북에서 저 멀리 AWS 에 있는 리눅스 서버의 명령줄을 쓰는 방법이다."
say "비밀번호 대신 '키 파일' 로 신원을 증명한다. 키는 두 조각이다 —"
say "공개키는 서버에 미리 넣어 두고, 개인키는 내 노트북에만 있다."
say ""
say "우리 개인키 위치:"
run ls -l "${INSIGHTA_SSH_KEY:-$HOME/.ssh/insighta/prx01-tubearchive.pem}"
note "권한이 600 이어야 한다. 다른 사용자가 읽을 수 있으면 ssh 가 거부한다."

step "왜 ssh 를 직접 치지 않는가"
say "서버 주소는 바뀐다. 인스턴스를 재생성하면 IP 가 달라지고, 방화벽은"
say "내 집 IP 만 허용하는데 통신사가 IP 를 바꾸면 갑자기 접속이 막힌다."
say ""
say "그래서 주소를 외우거나 파일에 적어 두지 않는다. scripts/ops/ssh.sh 가"
say "실행 시점에 AWS 에 '이름표가 insighta-k3s-1 인 서버 주소가 뭐야' 라고"
say "물어보고, 필요하면 방화벽에 지금 내 IP 를 넣은 뒤 접속한다."
say ""
say "이 스크립트가 아는 대상들 — 이름 하나가 서버 하나다:"
runsh "grep -oE '^ +[a-z0-9|]+\) echo \"insighta' '$SSH' | sed 's/) echo .*//; s/^ */    - /'"

step "실제로 들어가서 확인하기"
say "지금부터 나오는 출력은 전부 AWS 안의 서버가 대답한 것이다."
run bash "$SSH" k3s "hostname && uptime"

step "이 서버는 무엇을 돌리고 있나"
say "리눅스에서 '항상 떠 있어야 하는 프로그램' 은 systemd 라는 관리자가 맡는다."
say "우리 서버에서 가장 중요한 서비스는 k3s — 쿠버네티스 본체다."
run bash "$SSH" k3s "systemctl is-active k3s && systemctl show k3s -p ActiveEnterTimestamp --value"

step "자원은 얼마나 쓰고 있나"
say "t3.medium 은 vCPU 2, 메모리 4GB 다. 여유가 있는지 본다."
run bash "$SSH" k3s "free -h | head -2 && echo && df -h / | tail -1 && echo && nproc"

step "두 번째 서버도 같은 방식으로"
say "우리는 서버가 두 대다. 두 번째는 k3s2 라는 이름으로 부른다."
run bash "$SSH" k3s2 "hostname && free -h | head -2"

note "여기서 배운 것: 서버 주소는 코드에 적지 않는다. 이름으로 부르고,"
note "주소는 실행 시점에 AWS 에 물어본다. 이것이 이 프로젝트의 기본 규칙이다."

done_msg "Lab 01 완료 — 다음: lab02-containers.sh"
