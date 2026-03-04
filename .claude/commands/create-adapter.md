---
name: create-adapter
description: 새 어댑터 스캐폴딩 생성. /create-adapter <name> <category> 형태로 사용
---

새 데이터 소스 어댑터의 보일러플레이트 코드를 생성합니다.

사용법: /create-adapter <name> <category>

파라미터:
- name: 어댑터 이름 (예: notion, rss, markdown)
- category: 어댑터 카테고리 (oauth | feed | file)

카테고리 설명:
- oauth: OAuth 2.0 기반 서비스 (YouTube, Notion, Google Drive, LinkedIn)
- feed: 피드 기반 서비스 (RSS, Atom)
- file: 파일 파서 (Markdown, PDF, DOCX, PPTX, TXT)

예시:
```bash
/create-adapter notion oauth    # Notion 어댑터 생성
/create-adapter rss feed        # RSS 어댑터 생성
/create-adapter markdown file   # Markdown 어댑터 생성
```

실행할 명령:
```bash
npm run create:adapter -- --name $1 --category $2
```

생성 완료 후:
1. 생성된 파일 목록을 보여줘
2. 다음 단계 안내 (TODO 구현, 테스트, 등록)
3. adapter-dev subagent에게 구현을 위임할지 물어봐
