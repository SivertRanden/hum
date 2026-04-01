import { Router, Response } from 'express';
import { queries } from '../db.js';
import { requireAuth, AuthRequest } from '../middleware.js';

const router = Router();

// POST /api/invite/:token/join — join a space via invite link (auth required)
router.post('/:token/join', requireAuth, async (req: AuthRequest, res: Response) => {
  const { token } = req.params;
  const invite = await queries.getInviteToken(token);

  if (!invite) { res.status(404).json({ error: 'invite not found' }); return; }

  const now = Math.floor(Date.now() / 1000);
  if (invite.expires_at !== null && invite.expires_at < now) {
    res.status(410).json({ error: 'invite has expired' });
    return;
  }
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
    res.status(410).json({ error: 'invite has reached its use limit' });
    return;
  }

  const space = await queries.getSpaceById(invite.space_id);
  if (!space) { res.status(404).json({ error: 'space not found' }); return; }

  await queries.addSpaceMember(invite.space_id, req.user!.userId, 'member');
  await queries.incrementInviteUses(token);

  res.json({ space });
});

export default router;
