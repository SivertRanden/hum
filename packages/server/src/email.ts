import { Resend } from 'resend';
import type { PendingNotification } from './db.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'noreply@hum.app';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

let resend: Resend | null = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

export async function sendDigestEmail(to: string, username: string, notifications: PendingNotification[]): Promise<void> {
  const items = notifications.map(n =>
    `<li><b>@${n.sender_username}</b> in <b>#${n.channel}</b> (${n.space_name}): ${n.message_content.slice(0, 200)}</li>`
  ).join('');
  const html = `
    <p>Hi ${username},</p>
    <p>You were mentioned while you were away:</p>
    <ul>${items}</ul>
    <p><a href="${CLIENT_ORIGIN}">Open hum</a></p>
  `;

  if (!resend) {
    console.log(`[email] Digest for ${username} (${to}): ${notifications.length} mention(s)`);
    return;
  }

  await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `You have ${notifications.length} unread mention${notifications.length === 1 ? '' : 's'} on hum`,
    html,
  });
}

export async function sendPasswordResetEmail(to: string, username: string, token: string): Promise<void> {
  const resetUrl = `${CLIENT_ORIGIN}?reset_token=${token}`;

  if (!resend) {
    // Dev fallback: log to console when no email provider is configured
    console.log(`[email] Password reset for ${username} (${to}): ${resetUrl}`);
    return;
  }

  await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: 'Reset your hum password',
    html: `
      <p>Hi ${username},</p>
      <p>Click the link below to reset your password. The link expires in 1 hour.</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `,
  });
}
