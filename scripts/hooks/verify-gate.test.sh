#!/bin/bash
# Regression checks for scripts/verify-gate.sh. Uses a throwaway repo with a frontend change; saves and restores /tmp/.verify-pass.
H="$1"; T="$(mktemp -d)"; M=/tmp/.verify-pass; SAVE="$T/marker.save"; [ -f "$M" ] && cp "$M" "$SAVE"
trap '[ -f "$SAVE" ] && cp "$SAVE" "$M" || rm -f "$M"' EXIT
git init -q -b main "$T/origin" && (cd "$T/origin" && mkdir -p frontend/src && echo a > frontend/src/a.ts && echo r > README.md && git add . && git -c user.name=t -c user.email=t@e.com commit -q -m init)
git clone -q "$T/origin" "$T/fe" && (cd "$T/fe" && git checkout -q -b feat && echo b >> frontend/src/a.ts && git -c user.name=t -c user.email=t@e.com commit -qam fe)
git clone -q "$T/origin" "$T/be" && (cd "$T/be" && git checkout -q -b feat && echo b >> README.md && git -c user.name=t -c user.email=t@e.com commit -qam be)
SHA="$(git -C "$T/fe" rev-parse HEAD)"; pass=0; fail=0
run() { # <name> <expected exit> <expect stderr y/n> <command text>
  local out err rc
  err="$(python3 -c 'import json,sys; print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]}}))' "$4" | bash "$H" 2>&1 >/dev/null)"; rc=$?
  local ok=1; [ "$rc" = "$2" ] || ok=0
  if [ "$3" = y ]; then [ -n "$err" ] || ok=0; else [ -z "$err" ] || ok=0; fi
  if [ $ok = 1 ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $1: rc=$rc (want $2) stderr=[$err]"; fi
}
rm -f "$M"
run "no marker blocks with exit 2 and a reason on stderr" 2 y "cd $T/fe && git push origin HEAD"
run "git -C form is a push too" 2 y "git -C $T/fe push origin HEAD"
run "push after && and with an env prefix" 2 y "cd $T/fe && echo hi && GIT_TRACE=0 git push"
run "bash -c quoted push" 2 y "cd $T/fe && bash -c \"git push origin HEAD\""
run "gh pr create is gated" 2 y "cd $T/fe && gh pr create --fill"
run "backend-only change passes" 0 n "cd $T/be && git push origin HEAD"
run "plain command passes" 0 n "cd $T/fe && git status"
run "words inside a here-document are not a push" 0 n "cd $T/fe && cat > notes.txt <<'EOF'
run: git push origin main
gh pr create
EOF"
run "mention in prose (git log --grep push) is not a push" 0 n "cd $T/fe && git log --grep 'push fix' && echo 'do not git-push yet'"
run "here-document then a real push still blocks" 2 y "cd $T/fe && cat > n.txt <<EOF
note
EOF
git push origin HEAD"
echo "PASS $(( $(date +%s) - 700 )) $SHA" > "$M"
run "expired marker blocks" 2 y "cd $T/fe && git push origin HEAD"
echo "PASS $(date +%s) 0000000000000000000000000000000000000000" > "$M"
run "marker for another commit blocks" 2 y "cd $T/fe && git push origin HEAD"
echo "PASS $(date +%s) $SHA" > "$M"
run "fresh marker for this commit passes" 0 n "cd $T/fe && git push origin HEAD"
run "marker written in the same command as the push is not trusted when stale" 0 n "cd $T/fe && echo x > /dev/null && git push origin HEAD"
# gh pr merge <n> is judged by that PR's files and head commit (fake gh: no network in this test)
FAKE="$T/fake-gh"; printf '#!/bin/bash\ncat "%s/pr-$3.json"\n' "$T" > "$FAKE"; chmod +x "$FAKE"
printf '{"headRefOid":"%s","files":[{"path":"scripts/x.sh"}]}' "1111111111111111111111111111111111111111" > "$T/pr-11.json"
printf '{"headRefOid":"%s","files":[{"path":"frontend/src/a.ts"}]}' "2222222222222222222222222222222222222222" > "$T/pr-12.json"
export VERIFY_GATE_GH="$FAKE"
rm -f "$M"
run "merge of a backend-only PR from a checkout with frontend changes passes" 0 n "cd $T/fe && gh pr merge 11 --squash"
run "merge of a frontend PR from a backend-only checkout needs /verify" 2 y "cd $T/be && gh pr merge 12 --squash"
echo "PASS $(date +%s) $SHA" > "$M"
run "marker for this checkout's commit does not cover another PR's head" 2 y "cd $T/fe && gh pr merge 12 --squash"
echo "PASS $(date +%s) 2222222222222222222222222222222222222222" > "$M"
run "marker for the PR head passes the merge" 0 n "cd $T/be && gh pr merge 12 --squash"
unset VERIFY_GATE_GH
echo "passed $pass failed $fail"; [ $fail = 0 ]
