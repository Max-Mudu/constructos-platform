import { env } from '../utils/env';

export interface EmailService {
  sendPasswordResetEmail(to: string, resetLink: string): Promise<void>;
}

const EXPIRY_MINUTES = 60;

function buildText(link: string): string {
  return (
    `You requested a password reset for your ConstructOS account.\n\n` +
    `Reset your password:\n${link}\n\n` +
    `This link expires in ${EXPIRY_MINUTES} minutes. If you did not request this, ignore this email.`
  );
}

function buildHtml(link: string): string {
  return (
    `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1a1a1a;max-width:480px;margin:auto;padding:24px">` +
    `<h2>Reset your ConstructOS password</h2>` +
    `<p>Click the link below to set a new password:</p>` +
    `<p><a href="${link}" style="color:#1d4ed8">Reset password</a></p>` +
    `<p style="color:#666;font-size:13px">This link expires in ${EXPIRY_MINUTES} minutes. ` +
    `If you did not request a reset, you can safely ignore this email.</p>` +
    `</body></html>`
  );
}

async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  if (!env.SMTP_HOST) {
    if (env.isProduction) {
      console.warn(
        `[email] SMTP not configured — password reset email NOT sent to ${to}. ` +
        'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in env vars.',
      );
      console.warn(`[email] Reset link (deliver manually during pilot): ${resetLink}`);
    } else {
      console.log(`[email-dev] Password reset for ${to} → ${resetLink}`);
    }
    return;
  }

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Reset your ConstructOS password',
    text: buildText(resetLink),
    html: buildHtml(resetLink),
  });
}

export const emailService: EmailService = { sendPasswordResetEmail };
