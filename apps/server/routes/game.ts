import { Router } from 'express';

export const gameRouter = Router();

gameRouter.post('/begin_game', (req, res) => {
  console.log('begin_game', req.body);
  res.json({ status: 'ok' });
});
