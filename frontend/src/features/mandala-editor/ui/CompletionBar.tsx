import { useTranslation } from 'react-i18next';

import type { EditorBlock } from '@/shared/types/mandala-ux';

interface CompletionBarProps {
  blocks: EditorBlock[];
  currentBlockIndex: number;
}

const ITEMS_PER_BLOCK = 8;
const TOTAL_ITEMS = 72; // 9 blocks * 8 items

export default function CompletionBar({ blocks, currentBlockIndex }: CompletionBarProps) {
  const { t } = useTranslation();
  const currentBlock = blocks[currentBlockIndex];
  const blockFilled = currentBlock ? currentBlock.items.filter((x) => x).length : 0;
  const totalFilled = blocks.reduce((sum, b) => sum + b.items.filter((x) => x).length, 0);
  const pct = Math.round((totalFilled / TOTAL_ITEMS) * 100);

  return (
    <div className="text-center mb-6">
      <p className="text-xs text-muted-foreground">
        {t('editor.completion.thisBlock')}{' '}
        <strong className="text-teal-400 font-bold">
          {blockFilled}/{ITEMS_PER_BLOCK}
        </strong>
        {' · '}
        {t('editor.completion.total')}{' '}
        <strong className="text-teal-400 font-bold">
          {totalFilled}/{TOTAL_ITEMS}
        </strong>
      </p>
      <div className="w-[200px] h-1 rounded-sm bg-white/[0.03] mx-auto mt-2 overflow-hidden">
        <div
          className="h-full rounded-sm bg-gradient-to-r from-primary to-teal-400 transition-[width] duration-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
