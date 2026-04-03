import { YouTubeSyncCard } from './YouTubeSyncCard';
import { LlmKeysSettingsTab } from './LlmKeysSettingsTab';

export function ConnectedServicesTab() {
  return (
    <div className="space-y-6">
      <YouTubeSyncCard />
      <LlmKeysSettingsTab />
    </div>
  );
}
