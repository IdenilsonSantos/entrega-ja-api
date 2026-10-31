import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import webpush from 'web-push';
import { config } from '../../config';
import { REDIS } from '../../infra/redis/redis.module';
import { DeviceToken, PushSubscription } from './notification.entity';
import type { PushJob } from './notifications.service';

const VAPID_KEY = 'push:vapid';

/**
 * Envio de push.
 * - Navegador: Web Push com chaves VAPID. Sem chaves no ambiente, um par é gerado uma vez e
 *   guardado no Redis, igual para todas as réplicas (trocar as chaves invalida as inscrições).
 * - Celular: API de push do Expo, com o token que o app registra ao entrar.
 * Inscrições que o serviço diz não existirem mais (404/410, DeviceNotRegistered) são apagadas.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  private keys?: { publicKey: string; privateKey: string };

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
    @InjectRepository(DeviceToken) private readonly devices: Repository<DeviceToken>,
  ) {}

  async vapidKeys() {
    if (this.keys) return this.keys;
    if (config.push.vapidPublicKey && config.push.vapidPrivateKey) {
      this.keys = { publicKey: config.push.vapidPublicKey, privateKey: config.push.vapidPrivateKey };
    } else {
      const fresh = webpush.generateVAPIDKeys();
      await this.redis.set(VAPID_KEY, JSON.stringify(fresh), 'NX');
      this.keys = JSON.parse((await this.redis.get(VAPID_KEY))!);
    }
    return this.keys!;
  }

  async send(job: PushJob) {
    const [subs, devices] = await Promise.all([
      this.subs.find({ where: { userId: job.userId } }),
      this.devices.find({ where: { userId: job.userId } }),
    ]);
    const results = await Promise.allSettled([this.sendWeb(subs, job), this.sendExpo(devices, job)]);
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) throw failed[0].reason;
    return { web: subs.length, native: devices.length };
  }

  private async sendWeb(subs: PushSubscription[], job: PushJob) {
    if (!subs.length) return;
    const keys = await this.vapidKeys();
    const payload = JSON.stringify({ title: job.title, body: job.body, link: job.link, type: job.type, tag: job.notificationId, urgent: !!job.urgent });
    const gone: string[] = [];
    await Promise.all(
      subs.map((s) =>
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            vapidDetails: { subject: config.push.vapidSubject, ...keys },
            TTL: job.urgent ? 60 : 3600,
            urgency: job.urgent ? 'high' : 'normal',
          })
          .catch((e: { statusCode?: number; message: string }) => {
            if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.id);
            else this.log.warn(`Web push falhou (${e.statusCode ?? '-'}): ${e.message}`);
          }),
      ),
    );
    if (gone.length) await this.subs.delete({ id: In(gone) });
  }

  private async sendExpo(devices: DeviceToken[], job: PushJob) {
    if (!devices.length) return;
    const messages = devices.map((d) => ({
      to: d.token,
      title: job.title,
      body: job.body,
      data: { link: job.link, type: job.type, notificationId: job.notificationId },
      sound: 'default',
      priority: job.urgent ? 'high' : 'default',
      channelId: job.urgent ? 'offers' : 'default',
      ttl: job.urgent ? 60 : 3600,
    }));
    const res = await fetch(config.push.expoUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(config.push.expoAccessToken && { authorization: `Bearer ${config.push.expoAccessToken}` }),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`Expo push respondeu ${res.status}`);
    const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    const gone = (body.data ?? []).map((r, i) => (r.details?.error === 'DeviceNotRegistered' ? devices[i].id : null)).filter(Boolean) as string[];
    if (gone.length) await this.devices.delete({ id: In(gone) });
  }
}
