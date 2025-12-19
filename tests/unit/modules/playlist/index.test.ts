/**
 * Playlist module index exports test
 */

import * as playlistModule from '../../../../src/modules/playlist';

describe('Playlist Module Index', () => {
  describe('Manager exports', () => {
    it('should export getPlaylistManager function', () => {
      expect(playlistModule.getPlaylistManager).toBeDefined();
      expect(typeof playlistModule.getPlaylistManager).toBe('function');
    });

    it('should return PlaylistManager instance', () => {
      const manager = playlistModule.getPlaylistManager();
      expect(manager).toBeDefined();
      expect(typeof manager.importPlaylist).toBe('function');
      expect(typeof manager.listPlaylists).toBe('function');
    });

    it('should return same instance from getPlaylistManager (singleton)', () => {
      const instance1 = playlistModule.getPlaylistManager();
      const instance2 = playlistModule.getPlaylistManager();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Export structure', () => {
    it('should export expected properties', () => {
      const exports = Object.keys(playlistModule);
      expect(exports).toContain('getPlaylistManager');
      expect(exports).toContain('PlaylistManager');
    });
  });
});
