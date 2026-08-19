#!/usr/bin/env bash
#
# Lab 02 — 컨테이너와 이미지
#
# 목표: '이미지' 와 '컨테이너' 의 차이, 이미지가 어디에 보관되는지,
#       그리고 우리 클러스터가 비밀번호 없이 그 보관소에서 이미지를
#       가져오는 구조를 확인한다.
#
# 안전: 전부 읽기 전용.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_cluster

lab_title "Lab 02 — 컨테이너와 이미지" "읽기 전용. 약 3분."

step "이미지와 컨테이너는 다른 것이다"
say "이미지 = 프로그램과 그것이 필요로 하는 모든 파일을 한 덩어리로 굳힌 것."
say "         레시피가 아니라 '완성된 냉동식품' 에 가깝다. 변하지 않는다."
say ""
say "컨테이너 = 그 이미지를 실제로 실행한 것. 같은 이미지로 3개를 띄우면"
say "           컨테이너는 3개, 이미지는 여전히 1개다."
say ""
say "우리 api 는 지금 3개가 떠 있지만 이미지는 하나다:"
kshow get pods -n insighta-prod -l app.kubernetes.io/component=api \
  -o custom-columns=POD:.metadata.name,IMAGE:.spec.containers[0].image --no-headers

step "이미지는 어디에 보관되나 — ECR"
say "이미지를 저장해 두는 창고를 '레지스트리' 라고 한다. 공개 창고가"
say "Docker Hub 이고, 우리는 AWS 의 비공개 창고인 ECR 을 쓴다."
say ""
say "이미지 주소를 뜯어 보면 창고 위치가 그대로 적혀 있다:"
runsh "bash '$SSH' k3s \"sudo k3s kubectl get deploy insighta-api -n insighta-prod -o jsonpath='{.spec.template.spec.containers[0].image}'\" 2>/dev/null | grep -v '^\[ssh\]' | awk -F/ '{print \"     레지스트리 : \" \$1; print \"     리포지토리 : \" \$2}' | sed 's/^/  /'"
note "앞부분이 AWS 계정 소유의 ECR 주소, 뒷부분이 리포지토리 이름과 태그다."

step "비밀번호 없이 어떻게 가져오나"
say "보통은 클러스터에 '풀 시크릿' 이라는 비밀번호를 넣어 둔다. 우리는 넣지"
say "않았다. 확인해 보자 — 결과가 비어 있어야 정상이다:"
kshow get secret -n insighta-prod --field-selector type=kubernetes.io/dockerconfigjson
say ""
say "대신 서버 자체에 '이 EC2 는 ECR 을 읽어도 된다' 는 권한(인스턴스 프로파일)이"
say "붙어 있고, kubelet 이 그 권한을 이미지 받을 때마다 임시 토큰으로 바꿔 준다."
say "그 번역기가 아래 파일이다:"
run bash "$SSH" k3s "ls -l /var/lib/rancher/credentialprovider/ 2>/dev/null; cat /var/lib/rancher/credentialprovider/config.yaml 2>/dev/null | head -20"
note "비밀번호가 어디에도 저장되지 않는다는 것이 요점이다. 토큰은 12시간마다"
note "새로 발급되고, 서버를 폐기하면 권한도 같이 사라진다."

step "지금 서버에 내려받아 둔 이미지 목록"
say "k3s 는 containerd 라는 실행기를 쓴다. 그 창고를 직접 들여다본다:"
run bash "$SSH" k3s "sudo k3s ctr images ls -q | grep -v sha256 | grep insighta | head -10"

step "태그 — 우리 구성의 알려진 약점"
say "태그는 이미지에 붙이는 이름표다. 우리가 지금 쓰는 태그를 확인해 보자:"
runsh "grep -n 'tag:' '$LAB_REPO/charts/insighta/values.yaml' | sed 's/^/     values.yaml:/'"
say ""
say "latest 는 '지금 최신' 이라는 뜻이므로, 어제의 latest 와 오늘의 latest 가"
say "다른 이미지를 가리킨다. 이름은 같은데 내용물이 바뀐다."
say ""
say "그 결과가 아래에 그대로 보인다. 배포 이력은 리비전 2개인데,"
say "두 리비전이 가리키는 이미지 문자열이 동일하다:"
kshow -n insighta-prod get rs -l app.kubernetes.io/component=api \
  -o custom-columns='REPLICASET:.metadata.name,REPLICAS:.spec.replicas,IMAGE:.spec.template.spec.containers[0].image' --no-headers
warn "따라서 kubectl rollout undo 는 '이전 코드' 로 돌아가지 못한다."
warn "파드만 새로 만들 뿐, 같은 latest 를 다시 받아온다."
say ""
say "여기에 pullPolicy 가 겹친다:"
kshow -n insighta-prod get deploy insighta-api -o jsonpath='{.spec.template.spec.containers[0].imagePullPolicy}'
say ""
say "IfNotPresent 는 '이미 받아 둔 게 있으면 다시 받지 않는다' 는 뜻이다."
say "서버 두 대가 서로 다른 시점에 latest 를 받아 두었다면, 같은 태그인데"
say "서로 다른 코드가 도는 상태가 된다."
say ""
say "지금 실제로 그런 상태인지 digest(내용물의 지문)로 확인한다:"
runsh "bash '$SSH' k3s \"sudo k3s kubectl -n insighta-prod get pods -o json\" 2>/dev/null | grep -v '^\[ssh\]' | python3 -c \"
import json,sys
d=json.load(sys.stdin); seen={}
for p in d['items']:
    for cs in p['status'].get('containerStatuses',[]) or []:
        seen.setdefault(cs['name'],set()).add(cs.get('imageID','').split('@')[-1][:19])
for c,g in sorted(seen.items()):
    print('  %-10s digest %d개  %s' % (c,len(g),'일치' if len(g)==1 else '불일치 — 노드마다 다른 코드'))
\""
note "지금은 일치한다. 하지만 그것은 운이 좋은 것이지 구조가 막아 준 것이"
note "아니다. 올바른 해법은 태그를 커밋 해시나 digest 로 고정하는 것이다."
note "그러면 리비전마다 이미지 문자열이 달라지고, rollout undo 가 진짜"
note "이전 코드로 되돌아간다."

done_msg "Lab 02 완료 — 다음: lab03-kubernetes-objects.sh"
