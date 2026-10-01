/**
 * Company names as a visitor should read them. The API serves SEC's official
 * registrant names, and 138 of the 196 are in capitals, often with a
 * state-of-incorporation suffix ("APPLIED MATERIALS INC /DE"). Title-casing
 * fixes most; the rest - acronyms, brand capitals, apostrophes and SEC's
 * surname-first order - are spelled out below, checked by hand against all
 * 196 names on 2026-10-01.
 */
const SPELLED_OUT: Record<string, string> = {
  AMZN: 'Amazon.com Inc',
  AZO: 'AutoZone Inc',
  BAC: 'Bank of America Corp',
  BDX: 'Becton Dickinson & Co',
  BMY: 'Bristol-Myers Squibb Co',
  CL: 'Colgate-Palmolive Co',
  CME: 'CME Group Inc.',
  COP: 'ConocoPhillips',
  CSX: 'CSX Corp',
  DHI: 'D.R. Horton Inc',
  EBAY: 'eBay Inc',
  EOG: 'EOG Resources Inc',
  FCX: 'Freeport-McMoRan Inc',
  FDX: 'FedEx Corp',
  JPM: 'JPMorgan Chase & Co',
  KLAC: 'KLA Corp',
  KMB: 'Kimberly-Clark Corp',
  KO: 'Coca-Cola Co',
  LOW: "Lowe's Companies Inc",
  MCD: "McDonald's Corp",
  MCO: "Moody's Corp",
  MET: 'MetLife Inc',
  MRSH: 'Marsh & McLennan Companies, Inc.',
  NEE: 'NextEra Energy Inc',
  NEM: 'Newmont Corp',
  NVDA: 'NVIDIA Corp',
  ORLY: "O'Reilly Automotive Inc",
  PEP: 'PepsiCo Inc',
  PNC: 'PNC Financial Services Group, Inc.',
  SCHW: 'Charles Schwab Corp',
  SHW: 'Sherwin-Williams Co',
  SLB: 'SLB Limited',
  T: 'AT&T Inc.',
  TJX: 'TJX Companies Inc',
  TTWO: 'Take-Two Interactive Software Inc',
  UNH: 'UnitedHealth Group Inc',
  USB: 'U.S. Bancorp',
  YUM: 'Yum! Brands Inc',
};

/** "/DE", "\DE\", "/new", "/new/", "/ MA" at the end of an SEC name. */
const SEC_SUFFIX = /\s*[/\\]\s*[A-Za-z]{2,3}[/\\]?\s*$/;

export function displayName(ticker: string, secName: string): string {
  const spelled = SPELLED_OUT[ticker];
  if (spelled) return spelled;
  const name = secName.replace(SEC_SUFFIX, '').trim();
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-&(.])([a-z])/g, (_match, before: string, letter: string) => before + letter.toUpperCase());
}
