/**
 * Unit tests for `toRunpodOpenAiBase` (CP475+1 hotfix).
 *
 * The function must accept BOTH:
 *   (a) RunPod Serverless / `--root-path /openai` style: `.../openai/v1`
 *   (b) Standard vLLM Pod (no root-path):              `.../v1`
 *
 * Before CP475+1 it only handled (a) and silently appended `/openai/v1` to
 * (b), producing `https://<pod>.proxy.runpod.net/v1/openai/v1` which 404s.
 */

import { toRunpodOpenAiBase } from '@/api/routes/copilotkit-base-url';

describe('toRunpodOpenAiBase', () => {
  describe('Pod-direct vLLM (CP475+1 — primary regression case)', () => {
    it('passes through ".../v1" unchanged', () => {
      expect(toRunpodOpenAiBase('https://bec5sptl1a5f8d-8000.proxy.runpod.net/v1')).toBe(
        'https://bec5sptl1a5f8d-8000.proxy.runpod.net/v1'
      );
    });

    it('strips trailing slash but otherwise leaves ".../v1/" unchanged', () => {
      expect(toRunpodOpenAiBase('https://bec5sptl1a5f8d-8000.proxy.runpod.net/v1/')).toBe(
        'https://bec5sptl1a5f8d-8000.proxy.runpod.net/v1'
      );
    });
  });

  describe('Serverless / root-path /openai', () => {
    it('passes through ".../openai/v1" unchanged', () => {
      expect(toRunpodOpenAiBase('https://api.runpod.ai/v2/abc/openai/v1')).toBe(
        'https://api.runpod.ai/v2/abc/openai/v1'
      );
    });

    it('appends "/openai/v1" when the URL ends with "/runsync"', () => {
      expect(toRunpodOpenAiBase('https://api.runpod.ai/v2/abc/runsync')).toBe(
        'https://api.runpod.ai/v2/abc/openai/v1'
      );
    });

    it('appends "/openai/v1" when the URL ends with "/run"', () => {
      expect(toRunpodOpenAiBase('https://api.runpod.ai/v2/abc/run')).toBe(
        'https://api.runpod.ai/v2/abc/openai/v1'
      );
    });

    it('appends "/openai/v1" when the URL is a bare Serverless ID', () => {
      expect(toRunpodOpenAiBase('https://api.runpod.ai/v2/abc')).toBe(
        'https://api.runpod.ai/v2/abc/openai/v1'
      );
    });
  });

  describe('Edge cases', () => {
    it('handles multiple trailing slashes', () => {
      expect(toRunpodOpenAiBase('https://example.com/v1///')).toBe('https://example.com/v1');
    });
  });
});
