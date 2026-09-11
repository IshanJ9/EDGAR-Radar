import express from 'express';
import companiesRouter from './routes/companies';
import authRouter from './routes/auth';
import watchlistRouter from './routes/watchlist';
import { bullBoardRouter } from './bullBoard';

export const app = express();
app.use(express.json());
app.use('/companies', companiesRouter);
app.use('/auth', authRouter);
app.use('/watchlist', watchlistRouter);
app.use('/admin/queues', bullBoardRouter);
