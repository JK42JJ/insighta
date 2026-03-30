/**
 * Shared email transporter — Gmail SMTP Relay (IP-authenticated)
 *
 * Used by skills that send email output (newsletter, research-report).
 * EC2 IP (44.231.152.49) is whitelisted in Google Workspace Admin.
 */

import nodemailer from 'nodemailer';
import { config } from '@/config/index';

export const transporter = nodemailer.createTransport({
  host: config.gmail.smtpHost,
  port: config.gmail.smtpPort,
  secure: false, // STARTTLS
  name: 'insighta.one', // EHLO hostname — must match Workspace domain
  tls: { rejectUnauthorized: true },
});
