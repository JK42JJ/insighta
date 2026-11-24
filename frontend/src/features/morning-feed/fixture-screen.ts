/** Screens the watch fixture (/morning-cards?view=watch&fixture=1&screen=…) can open directly. */
export type FixtureScreen = 'onb' | 'input' | 'watch' | 'insight';

const SCREENS: readonly FixtureScreen[] = ['onb', 'input', 'watch', 'insight'];

function isFixtureScreen(value: string | null): value is FixtureScreen {
  return value !== null && (SCREENS as readonly string[]).includes(value);
}

/** `screen` query value -> screen; anything else is the prototype's default (온보딩). */
export function parseFixtureScreen(value: string | null): FixtureScreen {
  return isFixtureScreen(value) ? value : 'onb';
}
