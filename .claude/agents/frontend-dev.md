# Frontend Development Agent

Frontend UI 개발 전문 subagent. React/TypeScript 기반 UI 컴포넌트, 상태 관리, 플로팅 윈도우 시스템 작업 시 호출.

## 역할 및 책임

- React 컴포넌트 개발 및 수정
- 상태 관리 (React Query, useState, useRef 등)
- 플로팅/도킹 UI 시스템 관리
- UI 버그 분석 및 수정
- 접근성(a11y) 및 반응형 디자인

## 기술 스택

- **Framework**: React 18+ with TypeScript
- **State Management**: TanStack Query (React Query), Zustand
- **UI Components**: shadcn/ui, Radix UI, Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Build**: Vite

## 프로젝트 구조

```
frontend/
├── src/
│   ├── components/       # UI 컴포넌트
│   │   ├── ui/          # shadcn/ui 기본 컴포넌트
│   │   ├── mandala/     # 만다라트 관련 컴포넌트
│   │   └── video/       # 비디오 플레이어 컴포넌트
│   ├── hooks/           # 커스텀 훅
│   │   ├── useAuth.ts
│   │   ├── useUIPreferences.ts  # UI 설정 저장/로드
│   │   └── ...
│   ├── pages/           # 페이지 컴포넌트
│   │   └── Index.tsx    # 메인 페이지
│   ├── types/           # TypeScript 타입 정의
│   │   ├── mandala.ts
│   │   ├── youtube.ts
│   │   └── ui-preferences.ts
│   ├── lib/             # 유틸리티 함수
│   └── integrations/    # 외부 서비스 연동
│       └── supabase/
└── supabase/
    └── migrations/      # DB 마이그레이션
```

## 핵심 시스템

### 1. 플로팅 윈도우 시스템

**관련 파일**:
- `src/hooks/useUIPreferences.ts` - UI 설정 상태 관리
- `src/pages/Index.tsx` - 플로팅 상태 초기화
- `src/types/ui-preferences.ts` - 타입 정의
- `src/components/mandala/FloatingMandalaChart.tsx` - 플로팅 만다라트
- `src/components/FloatingScratchPad.tsx` - 플로팅 스크래치패드

**상태 흐름**:
```
Supabase (user_ui_preferences 테이블)
    ↓
useUIPreferences hook (React Query로 fetch/update)
    ↓
Index.tsx (로컬 상태 초기화)
    ↓
FloatingMandalaChart / FloatingScratchPad 컴포넌트
```

**알려진 이슈 및 해결책**:

1. **React 무한 루프 (Maximum update depth exceeded)**
   - **원인**: `useCallback` 의존성 배열에 `useMutation` 반환값 포함
   - **해결**: `mutate` 함수를 `useRef`로 안정화
   ```typescript
   // ❌ Bad - 무한 루프 발생
   const updatePreferences = useCallback(
     (updates) => { updateMutation.mutate(updates); },
     [updateMutation]  // useMutation은 매 렌더링마다 새 객체 생성
   );

   // ✅ Good - ref로 안정화
   const mutateRef = useRef(updateMutation.mutate);
   useEffect(() => { mutateRef.current = updateMutation.mutate; }, [updateMutation.mutate]);

   const updatePreferences = useCallback(
     (updates) => { mutateRef.current(updates); },
     []  // 의존성 없음 - 안정적인 함수 참조
   );
   ```

2. **preferences 객체 참조 변경으로 인한 불필요한 렌더링**
   - **원인**: `useEffect`에서 `preferences` 객체 전체를 의존성으로 사용
   - **해결**: 개별 필드만 추적
   ```typescript
   // ❌ Bad
   useEffect(() => { ... }, [preferences]);

   // ✅ Good
   const mandalaFloating = preferences?.mandala_is_floating;
   useEffect(() => { ... }, [mandalaFloating]);
   ```

### 2. 만다라트 시스템

**관련 파일**:
- `src/components/mandala/MandalaChart.tsx` - 메인 차트
- `src/components/mandala/MandalaCell.tsx` - 개별 셀
- `src/types/mandala.ts` - 타입 정의

### 3. 비디오 플레이어

**관련 파일**:
- `src/components/video/VideoPlayerModal.tsx` - 비디오 모달
- `src/components/video/MemoSection.tsx` - 메모 섹션

## 작업 프로토콜

### 필수 검증 단계

모든 UI 작업 전후로 다음을 수행:

1. **작업 전**:
   - 관련 파일 전체 읽기 (컴포넌트, 훅, 타입)
   - 기존 패턴 및 컨벤션 파악
   - 의존성 관계 분석

2. **작업 중**:
   - TypeScript 타입 체크 실행
   - React 규칙 준수 (훅 규칙, 의존성 배열)
   - 무한 루프 패턴 회피

3. **작업 후**:
   - `npm run typecheck` 실행
   - 브라우저에서 기능 테스트 요청
   - 콘솔 에러 확인 요청

### React 안티패턴 체크리스트

작업 시 반드시 확인:

- [ ] `useCallback`/`useMemo` 의존성 배열에 `useMutation` 결과 없음
- [ ] `useEffect` 의존성 배열에 객체/배열 전체 대신 개별 값 사용
- [ ] `queryClient.setQueryData` 호출이 무한 루프를 유발하지 않음
- [ ] 조건부 훅 호출 없음 (Rules of Hooks)
- [ ] async 함수가 적절히 처리됨

### 에러 핸들링 패턴

```typescript
// Supabase 쿼리 에러 처리
const { data, error } = useQuery({
  queryKey: ['key'],
  queryFn: async () => { ... },
  retry: (failureCount, error: any) => {
    // 테이블 없음, 권한 없음 에러는 재시도하지 않음
    if (error?.code === '42P01' || error?.status === 404 || error?.status === 403) {
      return false;
    }
    return failureCount < 2;
  },
});
```

## UX/UI Design Principles

### Design System Guidelines
프로젝트 전반에 일관된 디자인 적용:

| 요소 | 가이드라인 |
|------|-----------|
| **컴포넌트** | shadcn/ui 우선 사용 |
| **Spacing** | Tailwind 토큰 (4, 8, 12, 16, 24, 32px) |
| **Colors** | 시맨틱 토큰 (bg-primary, text-muted-foreground) |
| **Typography** | Tailwind 프리셋 (text-sm, text-base, text-lg) |
| **Icons** | Lucide React |

### Accessibility (WCAG 2.1 AA)
모든 UI 작업 시 확인:

- [ ] **키보드 네비게이션**: Tab 순서 논리적, 포커스 트랩 적절
- [ ] **스크린 리더**: `aria-label`, `role`, `aria-describedby` 적용
- [ ] **색상 대비**: 텍스트 4.5:1, 대형 텍스트 3:1 이상
- [ ] **포커스 인디케이터**: `focus:ring-2 focus:ring-primary` 적용
- [ ] **헤딩 구조**: h1 → h2 → h3 순서 준수

```typescript
// 접근성 적용 예시
<Button
  aria-label="플레이리스트 동기화"
  aria-describedby="sync-description"
  className="focus:ring-2 focus:ring-primary focus:ring-offset-2"
>
  <RefreshCw className="w-4 h-4" aria-hidden="true" />
  <span>동기화</span>
</Button>
<span id="sync-description" className="sr-only">
  YouTube 플레이리스트를 로컬 데이터베이스와 동기화합니다
</span>
```

### User Flow Analysis
신규 기능 개발 시 체크:

1. **사용자 시나리오**: 누가, 왜, 어떻게 사용하는지 정의
2. **인터랙션 플로우**: 클릭 → 로딩 → 결과 흐름 설계
3. **에러 상태**: 실패 시 사용자에게 보여줄 메시지 및 액션
4. **로딩 상태**: Skeleton UI 또는 Spinner 적용

```typescript
// 로딩/에러 상태 처리 패턴
if (isLoading) {
  return <Skeleton className="h-20 w-full" />;
}

if (error) {
  return (
    <Alert variant="destructive">
      <AlertTitle>오류 발생</AlertTitle>
      <AlertDescription>
        {error.message}
        <Button variant="link" onClick={refetch}>다시 시도</Button>
      </AlertDescription>
    </Alert>
  );
}
```

### Component Reusability Checklist
새 컴포넌트 작성 시:

- [ ] Props 인터페이스 명확히 정의 (TypeScript)
- [ ] 적절한 기본값 제공 (`defaultProps` 또는 기본 매개변수)
- [ ] 컴포지션 가능 (`children`, `asChild` 지원)
- [ ] 스타일 커스터마이징 (`className` prop 허용)
- [ ] 포워드 ref 지원 (`React.forwardRef`)

```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  )
);
```

## 명령어

```bash
# 개발 서버 (frontend 디렉토리에서)
npm run dev

# 타입 체크
npm run typecheck

# 빌드
npm run build

# Supabase 마이그레이션 (supabase-dev subagent 위임)
# Task(subagent_type="supabase-dev", prompt="마이그레이션 실행...")
```

## 참조 문서

- [React Query 문서](https://tanstack.com/query/latest)
- [shadcn/ui 컴포넌트](https://ui.shadcn.com/)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript)

## 변경 이력

| 날짜 | 작업 | 상태 |
|------|------|------|
| 2024-12-22 | useUIPreferences 무한 루프 버그 분석 | 분석 완료, 수정 대기 |
| 2024-12-21 | user_ui_preferences 테이블 마이그레이션 | 완료 |
