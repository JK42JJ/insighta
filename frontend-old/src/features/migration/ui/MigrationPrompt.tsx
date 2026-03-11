import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/shared/ui/alert-dialog';
import { Progress } from '@/shared/ui/progress';
import { useMigration } from '../model/useMigration';

export function MigrationPrompt() {
  const { t } = useTranslation();
  const { shouldPrompt, localDataSummary, status, error, migrate, dismiss } = useMigration();

  if (!shouldPrompt) return null;

  const isMigrating = status === 'migrating';
  const isError = status === 'error';

  return (
    <AlertDialog open={shouldPrompt}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('migration.title')}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{t('migration.description')}</span>
            {localDataSummary && (
              <span className="block rounded-md bg-muted px-3 py-2 text-sm font-medium">
                {t('migration.summary', {
                  goal: localDataSummary.rootGoal,
                  levels: localDataSummary.levelCount,
                })}
              </span>
            )}
            {isMigrating && (
              <span className="block pt-2">
                <Progress value={100} className="h-2 animate-pulse" />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t('migration.inProgress')}
                </span>
              </span>
            )}
            {isError && error && (
              <span className="block rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss} disabled={isMigrating}>
            {t('migration.dismiss')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={migrate} disabled={isMigrating}>
            {isMigrating
              ? t('migration.migrating')
              : isError
                ? t('migration.retry')
                : t('migration.migrate')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
