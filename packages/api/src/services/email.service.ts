import { env } from '../utils/env';

export interface EmailService {
  sendPasswordResetEmail(to: string, resetLink: string): Promise<void>;
  /**
   * Sends the "set up your account" email for an admin-created user.
   * Resolves true when the email was handed to SMTP, false when SMTP is not
   * configured. Rejects (with a link-free error) when SMTP delivery fails.
   */
  sendAccountSetupEmail(to: string, setupLink: string): Promise<boolean>;
}

/**
 * Both links are built on the password-reset token, which expires after the
 * same window (auth.service RESET_TOKEN_EXPIRES_MINUTES / user.service
 * SETUP_TOKEN_EXPIRES_MINUTES).
 */
const EXPIRY_MINUTES = 60;

// ─── Templates ────────────────────────────────────────────────────────────────

function wrapHtml(body: string): string {
  return (
    `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1a1a1a;max-width:480px;margin:auto;padding:24px">` +
    body +
    `</body></html>`
  );
}

function buildResetText(link: string): string {
  return (
    `You requested a password reset for your ConstructOS account.\n\n` +
    `Reset your password:\n${link}\n\n` +
    `This link expires in ${EXPIRY_MINUTES} minutes. If you did not request this, ignore this email.`
  );
}

function buildResetHtml(link: string): string {
  return wrapHtml(
    `<h2>Reset your ConstructOS password</h2>` +
    `<p>Click the link below to set a new password:</p>` +
    `<p><a href="${link}" style="color:#1d4ed8">Reset password</a></p>` +
    `<p style="color:#666;font-size:13px">This link expires in ${EXPIRY_MINUTES} minutes. ` +
    `If you did not request a reset, you can safely ignore this email.</p>`,
  );
}

function buildSetupText(link: string): string {
  return (
    `An account has been created for you on ConstructOS.\n\n` +
    `Set up your account by choosing a password:\n${link}\n\n` +
    `This link expires in ${EXPIRY_MINUTES} minutes. If it expires, use "Forgot password" ` +
    `on the sign-in page to get a new one. If you were not expecting this, ignore this email.`
  );
}

function buildSetupHtml(link: string): string {
  return wrapHtml(
    `<h2>Set up your ConstructOS account</h2>` +
    `<p>An account has been created for you. Click the link below to choose your password:</p>` +
    `<p><a href="${link}" style="color:#1d4ed8">Set up your account</a></p>` +
    `<p style="color:#666;font-size:13px">This link expires in ${EXPIRY_MINUTES} minutes. ` +
    `If it expires, use "Forgot password" on the sign-in page to get a new one. ` +
    `If you were not expecting this, you can safely ignore this email.</p>`,
  );
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

interface OutgoingEmail {
  /** Human label used in logs — never includes the link or recipient. */
  kind:    string;
  to:      string;
  link:    string;
  subject: string;
  text:    string;
  html:    string;
}

/**
 * Sends an email that carries a one-time credential link.
 *
 * The link is a bearer credential, so it must never reach production logs:
 *  - SMTP unset + production → log only that the email was not sent.
 *  - SMTP unset + development/test → print the link locally (guarded by
 *    !isProduction) so developers can follow the flow without SMTP.
 *  - SMTP failure → rethrow a fresh error built only from the error code, so
 *    an SMTP response that echoes the message body cannot leak the link
 *    through the global error handler.
 *
 * Returns true when SMTP accepted the message, false when SMTP is unset.
 */
async function deliver(email: OutgoingEmail): Promise<boolean> {
  if (!env.SMTP_HOST) {
    if (env.isProduction) {
      console.warn(
        `[email] SMTP not configured — ${email.kind} email not sent. ` +
        'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in env vars.',
      );
    } else {
      console.log(`[email-dev] ${email.kind} for ${email.to} → ${email.link}`);
    }
    return false;
  }

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return true;
  } catch (err) {
    const code = typeof (err as { code?: unknown })?.code === 'string'
      ? (err as { code: string }).code
      : 'UNKNOWN';
    // Deliberately do not chain `cause`: the original may contain the link.
    throw new Error(`[email] ${email.kind} email delivery failed (code: ${code})`);
  }
}

async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  await deliver({
    kind:    'password reset',
    to,
    link:    resetLink,
    subject: 'Reset your ConstructOS password',
    text:    buildResetText(resetLink),
    html:    buildResetHtml(resetLink),
  });
}

async function sendAccountSetupEmail(to: string, setupLink: string): Promise<boolean> {
  return deliver({
    kind:    'account setup',
    to,
    link:    setupLink,
    subject: 'Set up your ConstructOS account',
    text:    buildSetupText(setupLink),
    html:    buildSetupHtml(setupLink),
  });
}

export const emailService: EmailService = { sendPasswordResetEmail, sendAccountSetupEmail };
