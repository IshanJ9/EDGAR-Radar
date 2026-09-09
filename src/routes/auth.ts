import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createUser, getUserByEmail, DuplicateEmailError } from '../repositories/userRepository';

const router = Router();

const SALT_ROUNDS = 10;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET in .env (see .env.example).');
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// A precomputed bcrypt hash with no matching password, used to compare
// against when the email doesn't exist — keeps response time consistent
// between "unknown email" and "wrong password" so login can't be used to
// enumerate registered emails via timing.
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8i8H2fCqxTz8CvPk0YxUX4EJt/0PBu';

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(email, passwordHash);
    res.status(201).json({ id: user.id, email: user.email, createdAt: user.created_at });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const user = await getUserByEmail(email);
    const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !passwordMatches) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET!, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
