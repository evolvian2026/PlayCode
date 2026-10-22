import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";

// Outgoing email (scheduled reports). Configure SMTP_URL, e.g.
// smtps://user:pass@smtp.example.com:465; without it email is switched off.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

let override: Mailer | null | undefined;
let smtp: Transporter | undefined;

/** Tests swap in a fake; pass undefined to go back to SMTP. */
export function setMailer(m: Mailer | null | undefined): void {
  override = m;
}

export function mailer(): Mailer | null {
  if (override !== undefined) return override;
  if (!env.SMTP_URL) return null;
  smtp ??= nodemailer.createTransport(env.SMTP_URL);
  return {
    async send(mail) {
      await smtp!.sendMail({ from: env.MAIL_FROM, ...mail });
    },
  };
}
