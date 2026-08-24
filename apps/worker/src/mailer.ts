import nodemailer, { type Transporter } from 'nodemailer';

export function createMailer(): Transporter {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? '127.0.0.1',
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 1025,
    secure: false,
    auth:
      process.env.SMTP_USER !== undefined && process.env.SMTP_USER.length > 0
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
        : undefined,
  });
}
