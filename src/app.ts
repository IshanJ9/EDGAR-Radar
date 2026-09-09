import express from 'express';
import companiesRouter from './routes/companies';

export const app = express();
app.use(express.json());
app.use('/companies', companiesRouter);
