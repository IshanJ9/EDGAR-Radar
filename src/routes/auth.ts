import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { createUser, DuplicateEmailError } from '../repositories/userRepository';

const router = Router();

const SALT_ROUNDS = 10;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

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

export default router;
