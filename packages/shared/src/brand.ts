/**
 * OPS Tech brand tokens — code mirror of DESIGN.md at the repo root.
 *
 * These are used in non-CSS contexts (PDF renderer, email templates) where
 * we need the hex values from TypeScript. The Tailwind side of the app
 * gets these via CSS custom properties in apps/web/src/index.css.
 *
 * If a token here disagrees with DESIGN.md, DESIGN.md wins — update both.
 */

export const OPS_COLORS = {
  blueDark: '#1d2a5d',
  blue: '#2d3f89',
  blueLight: '#4356a0',
  blueLighter: '#eaecf5',

  redDark: '#7a1718',
  red: '#ad2122',
  redLight: '#c13435',
  redLighter: '#e5c7c7',

  grayDarkest: '#1a1a1a',
  grayDark: '#333333',
  gray: '#666666',
  grayLight: '#999999',
  grayLighter: '#cccccc',
  grayLightest: '#f3f3f3',

  white: '#ffffff',
} as const;

export type OpsColorToken = keyof typeof OPS_COLORS;

export const OPS_FONTS = {
  heading: "'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  body: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
} as const;

export const OPS_BRAND = {
  defaultAppName: 'Orono Peer Observations',
  defaultPrimaryColor: OPS_COLORS.blue,
} as const;
