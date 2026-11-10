import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { enqueue, registerOutboxHandler } from '../events/outbox';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Messages "sent" in the test environment, for assertions. */
export const testMailbox: MailMessage[] = [];

let transporter: Transporter | undefined;

function getTransporter(): Transporter | null {
  if (env.isTest) return null;
  if (!transporter) {
    transporter = env.SMTP_URL
      ? nodemailer.createTransport(env.SMTP_URL)
      : nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export async function sendMailNow(message: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) {
    testMailbox.push(message);
    return;
  }
  await t.sendMail({ from: env.MAIL_FROM, ...message });
  if (!env.SMTP_URL) {
    // No SMTP configured: log the email so developers can follow links (e.g. password reset).
    logger.info({ to: message.to, subject: message.subject, text: message.text }, 'Email (not sent: SMTP_URL is not set)');
  }
}

/** Queue an email through the outbox. Call it inside the business transaction. */
export function queueEmail(message: MailMessage): Promise<void> {
  return enqueue('email.send', { ...message });
}

registerOutboxHandler('email.send', async (payload) => {
  await sendMailNow(payload as unknown as MailMessage);
});
