#!/usr/bin/env bash
#
# Lab 09 — 장애가 났을 때 어디를 먼저 보나
#
# 목표: 증상에서 원인으로 가는 순서를 손에 익힌다. 실제 이 클러스터에서
#       겪은 사고들을 소재로, 그때 무엇을 봤어야 했는지 따라간다.
#
# 안전: 전부 읽기 전용 진단 명령.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_cluster

lab_title "Lab 09 — 장애가 났을 때 어디를 먼저 보나" "읽기 전용. 약 6분."

step "원칙: 증상에서 시작해 한 층씩 내려간다"
say "  바깥 → 안 순서로 좁힌다."
say ""
say "  1. 밖에서 접속되나        curl"
say "  2. 문지기가 받았나        ingress 로그"
say "  3. 규칙이 있나            ingress 객체"
say "  4. 서비스가 파드를 아나   endpoints"
say "  5. 파드가 살아 있나       get pods / describe"
say "  6. 앱이 뭐라고 하나       파드 로그"
say ""
warn "이 순서를 건너뛰고 '캐시겠지' '환경 차이겠지' 로 추측하면 반드시"
warn "엉뚱한 곳을 고치게 된다. 매 단계는 확인이지 짐작이 아니다."

step "1층 — 밖에서 접속되나"
runsh "
for u in https://insighta.one/health https://www.insighta.one/health https://insighta.one/; do
  curl -s -o /dev/null -w \"     %{http_code}  %{time_total}s  \$u\n\" --max-time 15 \$u
done
"

step "2층 — 문지기가 실제로 받았나"
say "ingress 컨트롤러의 로그에 방금 그 요청이 남아 있어야 한다."
say "host= 필드가 있어서 어느 도메인으로 들어왔는지 구분된다:"
runsh "bash '$SSH' k3s \"sudo k3s kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=6 --since=3m\" 2>/dev/null | grep -v '^\[ssh\]' | sed 's/^/     /' | cut -c1-150"
note "로그가 비어 있다면 요청이 아예 도착하지 않은 것이다 — DNS 나"
note "고정 IP 연결을 의심한다. 로그는 있는데 5xx 면 안쪽 문제다."

step "3층 — 규칙이 존재하고, 유효한가"
say "인그레스가 있어도 class 가 없으면 컨트롤러가 통째로 무시한다."
say "그런 경우 규칙은 보이는데 동작하지 않는다:"
kshow get ingress -A -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,CLASS:.spec.ingressClassName,HOSTS:.spec.rules[*].host' --no-headers
say ""
say "컨트롤러가 무시한 것이 있는지 직접 확인:"
runsh "bash '$SSH' k3s \"sudo k3s kubectl -n ingress-nginx logs deploy/ingress-nginx-controller --tail=400\" 2>/dev/null | grep -iE 'ignoring ingress|does not contain a valid IngressClass' | tail -5 | sed 's/^/     /' || echo '     (무시된 인그레스 없음)'"

step "4층 — 서비스가 살아 있는 파드를 알고 있나"
say "엔드포인트가 비어 있으면 서비스는 보낼 곳이 없다. 503 의 흔한 원인이다."
runsh "bash '$SSH' k3s \"sudo k3s kubectl -n insighta-prod get endpoints -o custom-columns=SVC:.metadata.name,ADDRS:.subsets[*].addresses[*].ip --no-headers\" 2>/dev/null | grep -v '^\[ssh\]' | sed 's/^/     /'"

step "5층 — 파드 상태와 최근 사건"
kshow get pods -n insighta-prod -o custom-columns='POD:.metadata.name,PHASE:.status.phase,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount,AGE:.metadata.creationTimestamp' --no-headers
say ""
say "재시작이 쌓이고 있으면 이유가 이벤트에 남는다:"
runsh "bash '$SSH' k3s \"sudo k3s kubectl -n insighta-prod get events --sort-by=.lastTimestamp\" 2>/dev/null | grep -v '^\[ssh\]' | tail -8 | cut -c1-140 | sed 's/^/     /'"

step "6층 — 앱이 뭐라고 하나"
say "여기까지 와서야 애플리케이션 로그를 본다. 먼저 보면 대개 길을 잃는다."
runsh "bash '$SSH' k3s \"sudo k3s kubectl -n insighta-prod logs deploy/insighta-api --tail=8 --since=10m\" 2>/dev/null | grep -v '^\[ssh\]' | cut -c1-150 | sed 's/^/     /'"

step "노드 자체는 괜찮은가"
say "메모리가 부족하면 쿠버네티스가 파드를 죽인다. 그러면 앱 로그에는"
say "아무 잘못도 안 나온다 — 원인이 앱 밖에 있기 때문이다."
kshow top nodes
runsh "bash '$SSH' k3s \"sudo k3s kubectl get nodes -o custom-columns='NODE:.metadata.name,MEMPRESSURE:.status.conditions[?(@.type==\\\"MemoryPressure\\\")].status,DISKPRESSURE:.status.conditions[?(@.type==\\\"DiskPressure\\\")].status,READY:.status.conditions[?(@.type==\\\"Ready\\\")].status' --no-headers\" 2>/dev/null | grep -v '^\[ssh\]' | sed 's/^/     /'"

step "인증서 만료 — 조용히 다가오는 장애"
say "HTTPS 인증서는 90일마다 갱신된다. 자동 갱신이 멈춰 있으면 아무 경고"
say "없이 어느 날 전부 접속 불가가 된다."
kshow get certificate -A -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[0].status,EXPIRY:.status.notAfter' --no-headers

step "이 클러스터에서 실제로 겪은 것들"
say "  · 504 — 요청이 60초에 잘렸다. 작업 자체는 140~181초 걸린다."
say "         ingress 기본 타임아웃이 60초, 예전 서버는 180초였다."
say "  · www 접속 불가 — 인그레스에 호스트가 하나만 있었다."
say "  · 보안 헤더 5개 → 1개 — 예전 nginx 가 서버 단위로 넣던 것이"
say "         컨트롤러로 옮기면서 빠졌다."
say "  · rate limit 소실 — 예전에는 /api 에만 걸려 있었다."
say "  · 인그레스가 무시됨 — class 를 선언하지 않아서."
note "공통점: 전부 '옮기면서 빠진 것' 이지 '새로 생긴 버그' 가 아니다."
note "인프라를 옮길 때는 기능 목록이 아니라 설정 항목을 대조해야 한다."

done_msg "Lab 09 완료 — 전체 과정 끝. 가이드 문서로 돌아가세요."
