import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // D&D 핵심 파일 보호 — auto-fix regression 방지 (CP248, CP268, CP271, CP324)
  // warn = 리포트하되 --fix 시 자동 수정 안 함
  // AppShell: DndContext 호스트. shellStore: dndHandlersRef 브릿지. minimap: useDroppable.
  {
    files: [
      'src/shared/lib/dnd/**',
      'src/pages/index/model/useCardDragDrop.ts',
      'src/pages/index/ui/IndexPage.tsx',
      'src/features/drag-select/model/useDragSelect.ts',
      'src/widgets/card-list/ui/DraggableCard.tsx',
      'src/widgets/scratch-pad/**/*.{ts,tsx}',
      'src/widgets/mandala-grid/ui/MandalaCell.tsx',
      'src/widgets/app-shell/ui/AppShell.tsx',
      'src/stores/shellStore.ts',
      'src/widgets/sidebar-heat-minimap/**/*.{ts,tsx}',
      'src/features/card-management/model/useBatchMoveCards.ts',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-unused-vars': 'warn',
      'prefer-const': 'warn',
    },
  },
])
