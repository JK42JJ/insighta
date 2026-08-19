#!/usr/bin/env bash
#
# Lab 03 — 쿠버네티스의 다섯 가지 물건
#
# 목표: 파드 · 디플로이먼트 · 서비스 · 인그레스 · 네임스페이스가
#       각각 무엇을 담당하는지, 요청 하나가 이들을 어떤 순서로 통과하는지
#       실제 클러스터에서 확인한다.
#
# 안전: 전부 읽기 전용.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_cluster

lab_title "Lab 03 — 쿠버네티스의 다섯 가지 물건" "읽기 전용. 약 5분."

step "네임스페이스 — 서랍 칸막이"
say "한 클러스터 안에 여러 시스템이 산다. 서로 이름이 겹치지 않도록"
say "칸을 나눈 것이 네임스페이스다. 우리 칸은 네 개다:"
kshow get ns -o custom-columns=NAME:.metadata.name,AGE:.metadata.creationTimestamp --no-headers
say ""
say "  insighta-prod  우리 서비스"
say "  ingress-nginx  바깥에서 들어오는 요청을 받는 문지기"
say "  cert-manager   HTTPS 인증서를 자동으로 발급/갱신"
say "  argocd         깃 저장소와 클러스터를 맞춰 주는 배포기"

step "파드 — 실제로 도는 것"
say "파드는 컨테이너를 감싼 가장 작은 실행 단위다. 죽으면 되살아나지 않고,"
say "'새 파드' 가 대신 만들어진다. 그래서 이름 뒤에 임의 문자열이 붙는다."
kshow get pods -n insighta-prod -o custom-columns='POD:.metadata.name,NODE:.spec.nodeName,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount' --no-headers
note "NODE 열을 보라. 같은 종류의 파드가 서버 두 대에 나뉘어 있다."
note "한 대가 죽어도 서비스가 이어지도록 일부러 흩어 놓은 것이다."

step "디플로이먼트 — 몇 개를 유지할지 정하는 규칙"
say "파드를 직접 만들지 않는다. '이 이미지로 3개 유지해' 라고 선언하면"
say "쿠버네티스가 알아서 3개를 맞춘다. 하나가 죽으면 즉시 새로 만든다."
kshow get deploy -n insighta-prod -o custom-columns='DEPLOY:.metadata.name,DESIRED:.spec.replicas,READY:.status.readyReplicas,IMAGE:.spec.template.spec.containers[0].image' --no-headers
say ""
say "'흩어 놓기' 규칙도 여기 선언돼 있다 — maxSkew 1 은 '서버 간 개수 차이가"
say "1 을 넘지 않게' 라는 뜻이다:"
kshow get deploy insighta-api -n insighta-prod -o jsonpath='{.spec.template.spec.topologySpreadConstraints}'

step "서비스 — 변하는 주소에 고정 이름 붙이기"
say "파드는 죽고 새로 생기며 IP 가 매번 바뀐다. 그래서 파드를 직접 부르지"
say "않고, 서비스라는 고정된 이름을 부른다. 서비스가 살아 있는 파드에게"
say "알아서 나눠 준다."
kshow get svc -n insighta-prod -o custom-columns='SERVICE:.metadata.name,TYPE:.spec.type,CLUSTER-IP:.spec.clusterIP,PORT:.spec.ports[0].port' --no-headers
say ""
say "지금 이 서비스가 실제로 누구에게 보내고 있는지 (엔드포인트):"
kshow get endpoints insighta-api -n insighta-prod -o jsonpath='{.subsets[*].addresses[*].ip}'

step "인그레스 — 어떤 주소를 어디로 보낼지"
say "바깥에서 온 요청의 도메인과 경로를 보고 어느 서비스로 넘길지 정한다."
kshow get ingress -n insighta-prod -o custom-columns='INGRESS:.metadata.name,CLASS:.spec.ingressClassName,HOSTS:.spec.rules[*].host' --no-headers
say ""
say "경로별 규칙을 펼쳐 보면:"
runsh "bash '$SSH' k3s \"sudo k3s kubectl get ingress -n insighta-prod -o json\" 2>/dev/null | grep -v '^\[ssh\]' | python3 -c \"
import json,sys
d=json.load(sys.stdin)
for it in d['items']:
    print('  '+it['metadata']['name']+'  (class='+str(it['spec'].get('ingressClassName'))+')')
    for r in it['spec']['rules']:
        for p in r['http']['paths']:
            print('     '+r['host']+p['path']+'  ->  '+p['backend']['service']['name']+':'+str(p['backend']['service']['port']['number']))
\""
warn "class 가 비어 있는 인그레스는 컨트롤러가 통째로 무시한다. 규칙이"
warn "존재하는데 동작하지 않는 가장 흔한 원인이다."

step "요청 하나가 지나가는 길"
say "  브라우저"
say "    → DNS 가 insighta.one 을 우리 고정 IP 로 알려 준다"
say "    → 그 IP 가 붙은 서버의 ingress-nginx 파드가 받는다"
say "    → 인그레스 규칙에서 도메인+경로로 목적지 서비스를 고른다"
say "    → 서비스가 살아 있는 파드 하나를 골라 넘긴다"
say "    → 파드 안의 컨테이너가 응답한다"
say ""
say "실제로 끝까지 통하는지 확인:"
runsh "curl -s -o /dev/null -w '     insighta.one     -> HTTP %{http_code}  (%{time_total}s)\n' https://insighta.one/health"
runsh "curl -s -o /dev/null -w '     www.insighta.one -> HTTP %{http_code}  (%{time_total}s)\n' https://www.insighta.one/health"

done_msg "Lab 03 완료 — 다음: lab04-helm.sh"
