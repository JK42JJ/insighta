#!/usr/bin/env bash
#
# Lab 04 — Helm: 같은 설계로 환경을 네 벌 만들기
#
# 목표: 차트(템플릿) + 값(환경별 차이) 이 어떻게 합쳐져 실제 YAML 이 되는지
#       직접 렌더해서 눈으로 본다. 클러스터에는 아무것도 보내지 않는다.
#
# 안전: 전부 로컬. helm template 은 렌더만 하고 아무 데도 접속하지 않는다.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

lab_title "Lab 04 — Helm: 같은 설계로 환경을 네 벌 만들기" \
  "로컬 전용. 클러스터 변경 없음. 약 5분."

CHART="$LAB_REPO/charts/insighta"

if ! command -v helm >/dev/null 2>&1; then
  warn "helm 이 설치돼 있지 않습니다.  brew install helm  후 다시 실행하세요."
  exit 1
fi

step "문제: 환경마다 조금씩 다른 같은 것"
say "개발·스테이징·검증·운영은 구조가 같다. 다른 것은 몇 가지 숫자와"
say "이름뿐이다 — 파드를 몇 개 띄울지, 도메인이 무엇인지, DB 를 클러스터"
say "안에 둘지 밖에 둘지."
say ""
say "이걸 YAML 네 벌로 복사해 두면 한 곳만 고치고 세 곳을 잊게 된다."
say "Helm 은 '틀 한 벌 + 환경별 값 네 벌' 로 이 문제를 없앤다."

step "틀 — templates/"
runsh "ls -1 '$CHART/templates' | sed 's/^/     /'"
say ""
say "값 — environments/"
runsh "ls -1 '$CHART/environments' | sed 's/^/     /'"

step "환경별로 무엇이 다른가"
say "운영 환경의 값 파일을 열어 보자. 이 파일이 곧 '운영은 이렇게 다르다'"
say "라는 선언이다:"
runsh "grep -vE '^\s*#|^\s*$' '$CHART/environments/prod.yaml' | head -40 | sed 's/^/     /'"

step "먼저: 운영 렌더는 일부러 거부된다"
say "운영 값으로 그냥 렌더하면 실패한다. 실패가 정상이다 — 왜 그런지 읽어 보자:"
runsh "helm template insighta '$CHART' -f '$CHART/environments/prod.yaml' 2>&1 | head -4 | fold -s -w 70 | sed 's/^/     /'"
say ""
say "이 리포지토리는 공개돼 있다. 이미지 창고 주소에는 AWS 계정 번호가"
say "들어 있으므로 파일에 적어 둘 수 없다. 그래서 차트는 '주소를 넣지"
say "않았으면 아예 만들지 않겠다' 고 거부한다."
note "값이 비면 조용히 빈 문자열로 렌더되는 것이 기본 동작이다. 그러면"
note "이미지 주소가 없는 배포가 나가서 운영이 멈춘다. 이 거부는 그것을"
note "막기 위해 일부러 넣은 것이다."
say ""
say "렌더만 해 볼 때는 아무 값이나 넣으면 된다. CI 도 같은 방법을 쓴다:"
say "  --set imageRegistry=registry.invalid"

REG="--set imageRegistry=registry.invalid"

step "렌더 — 틀과 값이 합쳐지면"
say "helm template 은 결과 YAML 을 만들어 화면에 보여 줄 뿐, 클러스터에"
say "보내지 않는다. 배포 전에 '무엇이 나갈지' 확인하는 가장 안전한 방법이다."
say ""
say "운영 환경으로 렌더했을 때 만들어지는 물건들:"
runsh "helm template insighta '$CHART' -f '$CHART/environments/prod.yaml' $REG | grep -E '^kind:|^  name:' | paste - - | sed 's/kind: //; s/name: //' | sort -u | sed 's/^/     /'"

step "같은 틀, 다른 값 — 개발 환경과 비교"
say "개발 환경에는 운영에 없는 것이 있다. 무엇인지 차이만 뽑아 본다:"
runsh "
prod=\$(helm template insighta '$CHART' -f '$CHART/environments/prod.yaml' $REG | grep -E '^  name:' | sort -u)
dev=\$(helm template insighta '$CHART' -f '$CHART/environments/dev.yaml' | grep -E '^  name:' | sort -u)
echo '     개발에만 있는 것:'
comm -13 <(echo \"\$prod\") <(echo \"\$dev\") | sed 's/  name: /       + /'
echo '     운영에만 있는 것:'
comm -23 <(echo \"\$prod\") <(echo \"\$dev\") | sed 's/  name: /       + /'
"
say ""
say "이 세 줄이 어디서 나왔는지 값 파일에서 확인하자:"
runsh "
echo '     dev.yaml   api.persistence.enabled = '\$(awk '/^api:/{a=1} a&&/persistence:/{p=1} p&&/enabled:/{print \$2; exit}' '$CHART/environments/dev.yaml')
echo '     prod.yaml  api.persistence.enabled = '\$(awk '/^api:/{a=1} a&&/persistence:/{p=1} p&&/enabled:/{print \$2; exit}' '$CHART/environments/prod.yaml')
echo '     prod.yaml  ingress.apiRateLimit     = '\$(grep -A2 'apiRateLimit:' '$CHART/environments/prod.yaml' | grep rps | tr -d ' ')
"
note "값 한 줄이 물건 하나를 만들고 없앤다. dev 의 persistence.enabled=true 가"
note "디스크 두 개를 만들었고, prod 의 apiRateLimit 가 인그레스를 하나 더"
note "만들었다. 템플릿은 양쪽 모두 같은 파일이다."

step "레플리카 수 비교"
say "같은 디플로이먼트 템플릿이 환경마다 다른 개수를 만든다:"
runsh "
for env in dev staging prod; do
  reg=''
  grep -q '^requireImageRegistry: true' '$CHART/environments/'\$env'.yaml' && reg='--set imageRegistry=registry.invalid'
  n=\$(helm template insighta '$CHART' -f '$CHART/environments/'\$env'.yaml' \$reg 2>&1 | awk '/^kind: Deployment/{d=1} d&&/^  name: insighta-api\$/{f=1} f&&/replicas:/{print \$2; exit}')
  printf '     %-9s api replicas = %s\n' \"\$env\" \"\${n:-렌더실패}\"
done
"

step "렌더가 깨지면 배포도 깨진다 — CI 가 먼저 잡는다"
say "값 이름을 잘못 쓰거나 템플릿 문법을 틀리면 렌더 자체가 실패한다."
say "그것을 사람이 아니라 CI 가 잡도록 검사를 붙여 두었다:"
runsh "grep -E '^\s*(#|echo \"|check_)' '$LAB_REPO/scripts/ci/check-charts.sh' | grep -iE 'check|verify|ensure' | head -12 | sed 's/^/     /'"
say ""
say "직접 돌려 보자. 네 환경을 모두 렌더하고 규칙을 검사한다:"
runsh "bash '$LAB_REPO/scripts/ci/check-charts.sh' 2>&1 | tail -20 | sed 's/^/     /'"

done_msg "Lab 04 완료 — 다음: lab05-terraform.sh"
