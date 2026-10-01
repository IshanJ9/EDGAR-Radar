/**
 * Link previews (F5). Crawlers that build a preview card don't run
 * JavaScript, so the tags must be in index.html itself, and the image must
 * exist and be a raster image of the size the tags announce.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
const meta = (attr: 'property' | 'name', key: string) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];

describe('link previews', () => {
  test('index.html carries the Open Graph and card tags', () => {
    expect(meta('property', 'og:title')).toMatch(/EDGAR Radar/);
    expect(meta('property', 'og:description')).toBeTruthy();
    expect(meta('property', 'og:url')).toBe('https://edgar-radar.vercel.app/');
    expect(meta('property', 'og:image')).toBe('https://edgar-radar.vercel.app/og-image.png');
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });

  test('the preview image exists, is a PNG and is 1200 x 630 as announced', () => {
    const path = resolve(import.meta.dirname, '../public/og-image.png');
    expect(existsSync(path)).toBe(true);
    const png = readFileSync(path);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    // The IHDR chunk: width and height as big-endian 32-bit integers at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect([meta('property', 'og:image:width'), meta('property', 'og:image:height')]).toEqual(['1200', '630']);
  });
});
