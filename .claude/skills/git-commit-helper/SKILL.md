# Git Commit Helper Skill

Conventional Commits 기반 커밋 메시지 자동 생성 및 Git 워크플로우 지원.

## 사용법

```bash
/git-commit-helper [options]
```

## Conventional Commits 형식

### Commit Types

| Type | 설명 | 예시 |
|------|------|------|
| `feat` | 새로운 기능 추가 | `feat(auth): add OAuth 2.0 login` |
| `fix` | 버그 수정 | `fix(sync): resolve race condition` |
| `docs` | 문서 변경 (코드 변경 없음) | `docs(readme): update installation guide` |
| `style` | 코드 스타일 변경 (포맷팅, 세미콜론 등) | `style: apply prettier formatting` |
| `refactor` | 리팩토링 (기능/버그 변경 없음) | `refactor(api): extract validation logic` |
| `perf` | 성능 개선 | `perf(db): add index for faster queries` |
| `test` | 테스트 추가/수정 | `test(adapter): add unit tests for RSS` |
| `build` | 빌드 시스템/외부 의존성 변경 | `build: upgrade prisma to v5` |
| `ci` | CI 설정 변경 | `ci: add GitHub Actions workflow` |
| `chore` | 기타 변경 (코드/테스트 변경 없음) | `chore: update .gitignore` |
| `revert` | 이전 커밋 되돌리기 | `revert: feat(auth): add OAuth 2.0` |

### 메시지 형식

```
<type>(<scope>): <subject>

[body]

[footer]
```

**규칙**:
- **type**: 필수, 소문자
- **scope**: 선택, 변경 영역 (api, cli, db, sync, auth 등)
- **subject**: 필수, 명령형 현재 시제, 소문자 시작, 마침표 없음
- **body**: 선택, 변경 이유와 내용 상세 설명
- **footer**: 선택, Breaking Changes, Issue 참조

## 워크플로우

### 1. 변경사항 분석

```bash
# staged 변경사항 확인
git diff --staged --stat
git diff --staged
```

### 2. 변경 유형 판단

변경된 파일 분석 → 적절한 type 선택:

| 파일 패턴 | 추천 Type |
|----------|-----------|
| `src/**/*.ts` (새 기능) | `feat` |
| `src/**/*.ts` (버그 수정) | `fix` |
| `tests/**/*` | `test` |
| `*.md`, `docs/**` | `docs` |
| `package.json`, `tsconfig.json` | `build` |
| `.github/**` | `ci` |
| `.eslintrc`, `.prettierrc` | `style` |

### 3. Scope 결정

프로젝트 구조 기반 scope 추천:

| 디렉토리 | Scope |
|----------|-------|
| `src/api/` | `api` |
| `src/cli/` | `cli` |
| `src/modules/sync/` | `sync` |
| `src/modules/playlist/` | `playlist` |
| `src/modules/video/` | `video` |
| `src/adapters/` | `adapter` |
| `prisma/` | `db` |

### 4. Subject 작성 가이드

**Good Examples**:
- `add user authentication endpoint`
- `fix null pointer in sync handler`
- `update README with new API docs`

**Bad Examples**:
- ~~`Added user authentication endpoint`~~ (과거 시제)
- ~~`Fix null pointer in sync handler.`~~ (마침표)
- ~~`UPDATE README`~~ (대문자)

## Breaking Changes

하위 호환성을 깨는 변경 시:

```
feat(api)!: change authentication flow

BREAKING CHANGE: OAuth tokens now stored in secure cookie instead of localStorage.
Migration required: clear browser storage and re-authenticate.
```

또는 footer에:

```
feat(api): change authentication flow

BREAKING CHANGE: OAuth tokens now stored in secure cookie.
```

## Issue 연동

```
fix(sync): resolve race condition in batch processing

Closes #123
Fixes #456
Refs #789
```

## 예시

### 새 기능 추가

```
feat(adapter): add RSS feed adapter

- Implement RSSAdapter extending FeedAdapter
- Add feed parsing with rss-parser library
- Support Atom and RSS 2.0 formats
- Add unit tests for feed parsing

Closes #42
```

### 버그 수정

```
fix(sync): prevent duplicate video entries

Videos were being duplicated when playlist order changed.
Added deduplication check using videoId before insertion.

Fixes #78
```

### 리팩토링

```
refactor(api): extract rate limiting to middleware

- Move rate limiting logic from routes to middleware
- Add configurable rate limits per endpoint
- Improve error messages for rate limit exceeded
```

## 자동화 통합

### Pre-commit Hook 연동

```bash
# .husky/commit-msg
npx --no -- commitlint --edit "$1"
```

### Commitlint 설정

```javascript
// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['api', 'cli', 'sync', 'playlist', 'video', 'adapter', 'db', 'auth']
    ]
  }
};
```

## 참조

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)
- [Angular Commit Guidelines](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#commit)
- [Commitlint](https://commitlint.js.org/)
