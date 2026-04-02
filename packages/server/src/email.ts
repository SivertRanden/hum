import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'noreply@hum.app';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

let resend: Resend | null = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
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
