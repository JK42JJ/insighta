/**
 * Type declarations for the `youtube-transcript` ESM build subpath.
 *
 * The package ships no usable types and its `main` entry is broken under
 * ESM (CJS body + `"type": "module"`), so `extractor.ts` imports the
 * `.esm.js` build directly — which has no `.d.ts`. This declaration
 * mirrors the runtime shape of `parseTranscriptXml`'s output.
 */
declare module 'youtube-transcript/dist/youtube-transcript.esm.js' {
  export interface TranscriptItem {
    text: string;
    duration: number;
    offset: number;
    lang?: string;
  }
  export function fetchTranscript(
    videoId: string,
    options?: { lang?: string }
  ): Promise<TranscriptItem[]>;
}
