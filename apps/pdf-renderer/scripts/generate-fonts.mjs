#!/usr/bin/env node
/**
 * Download Google Fonts and generate embedded @font-face CSS with data: URLs.
 * Writes to assets/fonts-embedded.css
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '../assets');
const outputFile = path.join(assetsDir, 'fonts-embedded.css');

const FONTS = [
  {
    family: 'Lexend',
    weight: 400,
    url: 'https://fonts.gstatic.com/s/lexend/v26/wlptgwvFAVdoq2_F94zlCfv0bz1WCzsW_LA.ttf',
  },
  {
    family: 'Lexend',
    weight: 500,
    url: 'https://fonts.gstatic.com/s/lexend/v26/wlptgwvFAVdoq2_F94zlCfv0bz1WCwkW_LA.ttf',
  },
  {
    family: 'Lexend',
    weight: 600,
    url: 'https://fonts.gstatic.com/s/lexend/v26/wlptgwvFAVdoq2_F94zlCfv0bz1WC-UR_LA.ttf',
  },
  {
    family: 'Lexend',
    weight: 700,
    url: 'https://fonts.gstatic.com/s/lexend/v26/wlptgwvFAVdoq2_F94zlCfv0bz1WC9wR_LA.ttf',
  },
  {
    family: 'Roboto',
    weight: 300,
    url: 'https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuaabWmT.ttf',
  },
  {
    family: 'Roboto',
    weight: 400,
    url: 'https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbWmT.ttf',
  },
  {
    family: 'Roboto',
    weight: 500,
    url: 'https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWub2bWmT.ttf',
  },
  {
    family: 'Roboto',
    weight: 700,
    url: 'https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuYjammT.ttf',
  },
];

async function fetchAndEncode(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

async function generate() {
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const css = [];
  for (const font of FONTS) {
    console.log(`Fetching ${font.family} ${font.weight}...`);
    const b64 = await fetchAndEncode(font.url);
    css.push(`@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: ${font.weight};
  font-display: swap;
  src: url(data:font/ttf;base64,${b64}) format('truetype');
}`);
  }

  const cssContent = css.join('\n');
  fs.writeFileSync(outputFile, cssContent, 'utf-8');
  console.log(`Fonts embedded to ${outputFile}`);
}

generate().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
