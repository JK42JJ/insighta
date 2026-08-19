#!/usr/bin/env bash
#
# Lab 07 — ArgoCD: 깃에 적힌 것이 곧 클러스터의 상태
#
# 목표: 사람이 kubectl apply 를 치는 대신, 깃 저장소를 계속 읽어서
#       클러스터를 그에 맞추는 방식(GitOps)이 무엇인지 확인한다.
#
# 안전: 전부 읽기 전용. sync 를 유발하지 않는다.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_cluster

lab_title "Lab 07 — ArgoCD: 깃이 곧 클러스터의 상태" "읽기 전용. 약 4분."

step "손으로 배포할 때의 문제"
say "kubectl apply 로 배포하면 '지금 클러스터에 무엇이 떠 있는가' 를"
say "아무도 정확히 모른다. 누가 언제 무엇을 apply 했는지 기록이 없고,"
say "깃의 내용과 실제가 어긋나도 알 방법이 없다."
say ""
say "ArgoCD 는 반대로 한다 — 깃을 계속 읽고, 클러스터가 깃과 다르면"
say "'어긋났다(OutOfSync)' 고 알리거나 자동으로 맞춘다."

step "무엇을 지켜보고 있나"
kshow get applications -n argocd -o custom-columns='APP:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status,REVISION:.status.sync.revision' --no-headers

step "어느 저장소의 어느 경로를 보고 있나"
runsh "bash '$SSH' k3s \"sudo k3s kubectl get applications -n argocd -o json\" 2>/dev/null | grep -v '^\[ssh\]' | python3 -c \"
import json,sys
d=json.load(sys.stdin)
for a in d['items']:
    s=a['spec']['source']
    print('  '+a['metadata']['name'])
    print('     repo     '+s.get('repoURL',''))
    print('     path     '+s.get('path',''))
    print('     revision '+s.get('targetRevision',''))
    dst=a['spec']['destination']
    print('     -> ns    '+dst.get('namespace',''))
\""
note "targetRevision 이 브랜치 이름이면 그 브랜치에 머지되는 순간 배포된다."
note "고정된 태그면 사람이 값을 올려야 배포된다. 어느 쪽인지가 곧"
note "'자동 배포인가 수동 배포인가' 의 답이다."

step "Synced 와 Healthy 는 다른 말이다"
say "  Synced   = 깃에 적힌 것과 클러스터의 선언이 같다"
say "  Healthy  = 그 선언대로 실제로 잘 돌고 있다"
say ""
say "Synced 이면서 Degraded 일 수 있다 — 깃대로 배포했는데 그 코드가"
say "죽는 경우다. 반대로 OutOfSync 이면서 Healthy 일 수도 있다."
kshow get applications -n argocd -o custom-columns='APP:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status' --no-headers

step "자동으로 맞출 것인가, 알리기만 할 것인가"
runsh "bash '$SSH' k3s \"sudo k3s kubectl get applications -n argocd -o json\" 2>/dev/null | grep -v '^\[ssh\]' | python3 -c \"
import json,sys
d=json.load(sys.stdin)
for a in d['items']:
    sp=a['spec'].get('syncPolicy') or {}
    auto=sp.get('automated')
    print('  %-22s %s' % (a['metadata']['name'], 'automated: '+json.dumps(auto) if auto else 'manual (사람이 Sync 를 눌러야 함)'))
\""

step "화면으로 보기"
say "ArgoCD 에는 웹 화면이 있다. 인터넷에 열어 두지 않았으므로 SSH 두 번을"
say "거쳐서 들어간다. 이 스크립트가 그것을 대신한다:"
say ""
say "     bash scripts/ops/argocd-ui.sh              화면 열기"
say "     bash scripts/ops/argocd-ui.sh --password   비밀번호만 출력"
say "     bash scripts/ops/argocd-ui.sh --stop       터널 닫기"
warn "ArgoCD 는 클러스터 전체 권한을 가진다. 공개 주소를 붙이면 비밀번호"
warn "하나가 뚫리는 순간 클러스터 전체가 넘어간다. 그래서 SSH 안에 둔다."

step "현재 배포된 리비전 = 깃의 어느 지점인가"
runsh "bash '$SSH' k3s \"sudo k3s kubectl get applications -n argocd -o jsonpath='{range .items[*]}{.metadata.name}{\\\" \\\"}{.status.sync.revision}{\\\"\\\\n\\\"}{end}'\" 2>/dev/null | grep -v '^\[ssh\]' | sed 's/^/     /'"
note "이 해시를 git log 에서 찾으면 '지금 운영에 뭐가 떠 있는가' 가"
note "정확히 한 커밋으로 특정된다. 이것이 GitOps 의 핵심 이득이다."

done_msg "Lab 07 완료 — 다음: lab08-deploy-and-rollback.sh"
