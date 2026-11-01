import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { config, runsWorkers } from '../../config';
import { MAIL_QUEUE, QUEUE } from '../queue/queues';
import { createRedis } from '../redis/redis.module';
import { MailMessage, MailSender } from './mail.sender';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Moldura única dos e-mails: título, parágrafos e um botão opcional */
function layout(o: { title: string; paragraphs: string[]; button?: { label: string; url: string }; footer?: string }) {
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#3f3f46">${esc(t)}</p>`;
  const button = o.button
    ? `<p style="margin:24px 0"><a href="${esc(o.button.url)}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${esc(o.button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#71717a">Se o botão não abrir, copie este endereço no navegador:<br>${esc(o.button.url)}</p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
  <div style="font-weight:800;font-size:18px;color:#ea580c;margin-bottom:16px">Entrega Já</div>
  <div style="background:#fff;border-radius:16px;padding:28px">
    <h1 style="margin:0 0 16px;font-size:20px;color:#18181b">${esc(o.title)}</h1>
    ${o.paragraphs.map(p).join('')}${button}
  </div>
  ${o.footer ? `<p style="font-size:12px;color:#a1a1aa;margin:16px 4px 0">${esc(o.footer)}</p>` : ''}
</div></body></html>`;
  const text = [o.title, '', ...o.paragraphs, ...(o.button ? ['', `${o.button.label}: ${o.button.url}`] : []), ...(o.footer ? ['', o.footer] : [])].join('\n');
  return { html, text };
}

/** Coloca e-mails na fila; quem envia é o worker. A requisição nunca espera o provedor. */
@Injectable()
export class MailService {
  constructor(@Inject(MAIL_QUEUE) private readonly queue: Queue<MailMessage>) {}

  private enqueue(msg: MailMessage) {
    return this.queue.add('send', msg);
  }

  passwordReset(to: string, name: string, url: string) {
    return this.enqueue({
      to,
      subject: 'Redefinir sua senha',
      ...layout({
        title: 'Redefinir sua senha',
        paragraphs: [`Oi, ${name.split(' ')[0]}.`, `Recebemos um pedido para trocar a senha da sua conta. O link vale por ${config.passwordResetTtlMin} minutos e só pode ser usado uma vez.`],
        button: { label: 'Criar nova senha', url },
        footer: 'Não foi você? Pode ignorar este e-mail: sua senha continua a mesma.',
      }),
    });
  }

  passwordChanged(to: string, name: string) {
    return this.enqueue({
      to,
      subject: 'Sua senha foi alterada',
      ...layout({
        title: 'Sua senha foi alterada',
        paragraphs: [`Oi, ${name.split(' ')[0]}.`, 'A senha da sua conta acabou de ser trocada e as outras sessões foram encerradas.'],
        footer: 'Não foi você? Use "Esqueci minha senha" na tela de entrada e fale com o suporte.',
      }),
    });
  }
}

/** Processa a fila de e-mail (só no worker). Falha do provedor tenta de novo com espera crescente. */
@Injectable()
class MailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MailWorker');
  private worker?: Worker<MailMessage>;

  constructor(private readonly sender: MailSender) {}

  onModuleInit() {
    if (!runsWorkers) return;
    this.worker = new Worker<MailMessage>(QUEUE.mail, (job) => this.sender.send(job.data), { connection: createRedis(), concurrency: 5 });
    this.worker.on('failed', (job, err) => this.log.warn(`E-mail ${job?.id} falhou: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}

@Global()
@Module({ providers: [MailService, MailSender, MailWorker], exports: [MailService] })
export class MailModule {}
