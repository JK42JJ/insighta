export interface SlashCommand {
  id: string;
  icon: string;
  labelKey: string;
  enabled: boolean;
  requiresPlayer: boolean;
  category: 'media' | 'content' | 'ai';
}

export const SLASH_COMMAND_REGISTRY: SlashCommand[] = [
  { id: 'timestamp', icon: '⏱', labelKey: 'videoPlayer.insertTimestamp', enabled: true, requiresPlayer: true, category: 'media' },
  { id: 'capture', icon: '📸', labelKey: 'videoPlayer.insertCapture', enabled: true, requiresPlayer: true, category: 'media' },
  { id: 'link', icon: '🔗', labelKey: 'videoPlayer.insertLink', enabled: false, requiresPlayer: false, category: 'content' },
  { id: 'insight', icon: '💡', labelKey: 'videoPlayer.insertInsight', enabled: false, requiresPlayer: false, category: 'ai' },
];

export function getAvailableCommands(hasPlayer: boolean): SlashCommand[] {
  if (hasPlayer) return SLASH_COMMAND_REGISTRY;
  return SLASH_COMMAND_REGISTRY.filter((cmd) => !cmd.requiresPlayer);
}
