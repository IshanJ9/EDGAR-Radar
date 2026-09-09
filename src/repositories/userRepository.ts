import { pool } from '../db';

export class DuplicateEmailError extends Error {}

export interface UserRecord {
  id: number;
  email: string;
  created_at: string;
}

export async function createUser(email: string, passwordHash: string): Promise<UserRecord> {
  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at`,
      [email, passwordHash],
    );
    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') {
      throw new DuplicateEmailError(`Email ${email} is already registered.`);
    }
    throw err;
  }
}
