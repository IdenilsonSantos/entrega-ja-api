import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../../config';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Entrega o e-mail pelo provedor configurado (MAIL_PROVIDER).
 * - log:    só escreve no console (padrão, para quem roda sem conta em provedor nenhum)
 * - resend: API HTTP do Resend
 * - smtp:   qualquer provedor com SMTP; trocar de provedor é só trocar o SMTP_URL
 * Erro aqui faz o trabalho da fila tentar de novo.
 */
@Injectable()
export class MailSender {
  private readonly log = new Logger('Mail');
  private smtp?: Transporter;

  async send(msg: MailMessage) {
    switch (config.mail.provider) {
      case 'resend':
        return this.resend(msg);
      case 'smtp':
        return this.viaSmtp(msg);
      default:
        this.log.log(`[e-mail para ${msg.to}] ${msg.subject}\n${msg.text}`);
    }
  }

  private async resend(msg: MailMessage) {
    if (!config.mail.resendApiKey) throw new Error('MAIL_PROVIDER=resend sem RESEND_API_KEY');
    const res = await fetch(`${config.mail.resendUrl}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.mail.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.mail.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  private async viaSmtp(msg: MailMessage) {
    if (!config.mail.smtpUrl) throw new Error('MAIL_PROVIDER=smtp sem SMTP_URL');
    this.smtp ??= nodemailer.createTransport(config.mail.smtpUrl);
    await this.smtp.sendMail({ from: config.mail.from, ...msg });
  }
}
