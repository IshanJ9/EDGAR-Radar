import { describe, expect, test } from 'vitest';
import { displayName } from './names';

describe('displayName', () => {
  test('leaves a name SEC already writes in mixed case alone', () => {
    expect(displayName('AAPL', 'Apple Inc.')).toBe('Apple Inc.');
    expect(displayName('TSLA', 'Tesla, Inc.')).toBe('Tesla, Inc.');
  });

  test('title-cases an all-capitals SEC name', () => {
    expect(displayName('MSFT', 'MICROSOFT CORP')).toBe('Microsoft Corp');
    expect(displayName('BDX', 'BECTON DICKINSON & CO')).toBe('Becton Dickinson & Co');
  });

  test("drops SEC's state-of-incorporation and '/new' suffixes", () => {
    expect(displayName('AMAT', 'APPLIED MATERIALS INC /DE')).toBe('Applied Materials Inc');
    expect(displayName('VRTX', 'VERTEX PHARMACEUTICALS INC / MA')).toBe('Vertex Pharmaceuticals Inc');
    expect(displayName('XYZ', 'EXAMPLE HOLDINGS CORP \\DE\\')).toBe('Example Holdings Corp');
  });

  test('uses the hand-checked spelling where title-casing gets a brand wrong', () => {
    expect(displayName('JPM', 'JPMORGAN CHASE & CO')).toBe('JPMorgan Chase & Co');
    expect(displayName('NVDA', 'NVIDIA CORP')).toBe('NVIDIA Corp');
    expect(displayName('MCD', 'MCDONALDS CORP')).toBe("McDonald's Corp");
    expect(displayName('SCHW', 'SCHWAB CHARLES CORP')).toBe('Charles Schwab Corp');
    expect(displayName('T', 'AT&T INC.')).toBe('AT&T Inc.');
  });
});
