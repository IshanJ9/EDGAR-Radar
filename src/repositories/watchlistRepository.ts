import { DatabaseError } from 'pg';
import { pool } from '../db';
import { padCik } from '../sec';
import { upsertCompanyFacts, getCompanyByCik } from './companyRepository';

export class DuplicateWatchlistEntryError extends Error {}

export interface WatchlistEntry {
  cik: string;
  entityName: string;
}

export async function addToWatchlist(userId: number, cik: string): Promise<WatchlistEntry> {
  const paddedCik = padCik(cik);

  const existingCompany = await getCompanyByCik(paddedCik);
  if (!existingCompany) {
    await upsertCompanyFacts(paddedCik);
  }

  try {
    await pool.query('INSERT INTO watchlists (user_id, cik) VALUES ($1, $2)', [userId, paddedCik]);
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new DuplicateWatchlistEntryError(`CIK ${paddedCik} is already on this user's watchlist.`);
    }
    throw err;
  }

  const company = await getCompanyByCik(paddedCik);
  return { cik: paddedCik, entityName: company!.entityName };
}

export async function removeFromWatchlist(userId: number, cik: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM watchlists WHERE user_id = $1 AND cik = $2', [userId, padCik(cik)]);
  return result.rowCount! > 0;
}

export async function getWatchlist(userId: number): Promise<WatchlistEntry[]> {
  const result = await pool.query(
    `SELECT w.cik, c.entity_name
     FROM watchlists w
     JOIN companies c ON c.cik = w.cik
     WHERE w.user_id = $1
     ORDER BY w.cik`,
    [userId],
  );
  return result.rows.map((row) => ({ cik: row.cik, entityName: row.entity_name }));
}

export interface Watcher {
  userId: number;
  email: string;
}

/** The reverse of getWatchlist: given a company, who is watching it? Used by the Notification Worker. */
export async function getWatchersForCik(cik: string): Promise<Watcher[]> {
  const result = await pool.query(
    `SELECT u.id AS user_id, u.email
     FROM watchlists w
     JOIN users u ON u.id = w.user_id
     WHERE w.cik = $1`,
    [padCik(cik)],
  );
  return result.rows.map((row) => ({ userId: row.user_id, email: row.email }));
}
