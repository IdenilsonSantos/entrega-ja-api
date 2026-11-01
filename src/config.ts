/**
 * Configuração lida das variáveis de ambiente, num lugar só.
 *
 * APP_ROLE define o que o processo executa:
 *   api    → HTTP + SSE (pode ter várias réplicas atrás de um balanceador)
 *   worker → filas: despacho de entregadores e envio de push
 *   all    → os dois juntos (desenvolvimento)
 */
const env = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) throw new Error(`Variável de ambiente ausente: ${key}`);
  return value;
};
const num = (key: string, fallback: number) => Number(env(key, String(fallback)));

export type AppRole = 'api' | 'worker' | 'all';

export const config = {
  env: env('NODE_ENV', 'development'),
  port: num('PORT', 3000),
  role: env('APP_ROLE', 'all') as AppRole,
  databaseUrl: env('DATABASE_URL', 'postgres://delivery:delivery@localhost:5432/entregaja'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  jwt: {
    secret: env('JWT_SECRET', 'dev-secret-troque-em-producao'),
    expiresIn: env('JWT_EXPIRES_IN', '7d'),
  },
  /** Origens do front aceitas pelo CORS, separadas por vírgula */
  corsOrigins: env('CORS_ORIGIN', 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  /** Endereço do site, usado nos links das notificações e dos convites */
  appUrl: env('APP_URL', 'http://localhost:5173'),
  uploadDir: env('UPLOAD_DIR', './uploads'),
  dispatch: {
    /** Tempo que o entregador tem para aceitar uma oferta */
    offerTtlSec: num('DISPATCH_OFFER_TTL_SEC', 25),
    /** Espera antes de tentar de novo quando ninguém está disponível */
    retryDelayMs: num('DISPATCH_RETRY_DELAY_MS', 15000),
    /** Depois de tantas rodadas sem entregador, o admin é avisado (a busca continua) */
    alertAfterAttempts: num('DISPATCH_ALERT_AFTER', 8),
  },
  /** Entregador sem mandar localização por este tempo sai do mapa */
  presenceTtlSec: num('COURIER_PRESENCE_TTL_SEC', 60),
  /**
   * E-mail (recuperação de senha e avisos de segurança): log | resend | smtp.
   * log só escreve no console. resend usa a API do Resend (RESEND_API_KEY). smtp serve para
   * qualquer provedor com SMTP (SES, SendGrid, Postmark, Brevo, Mailpit no desenvolvimento).
   */
  mail: {
    provider: env('MAIL_PROVIDER', 'log') as 'log' | 'resend' | 'smtp',
    from: env('MAIL_FROM', 'Entrega Já <nao-responda@entregaja.dev>'),
    resendApiKey: env('RESEND_API_KEY', ''),
    resendUrl: env('RESEND_API_URL', 'https://api.resend.com'),
    /** smtp://usuario:senha@host:587 ou smtps://usuario:senha@host:465 */
    smtpUrl: env('SMTP_URL', ''),
  },
  /** Validade do link de "esqueci minha senha" */
  passwordResetTtlMin: num('PASSWORD_RESET_TTL_MIN', 60),
  /**
   * Limite de requisições por IP, contado no Redis (vale para todas as réplicas).
   * As rotas de login, cadastro e recuperação de senha têm limites próprios, mais curtos.
   */
  rateLimit: {
    enabled: env('RATE_LIMIT_ENABLED', 'true') === 'true',
    perMinute: num('RATE_LIMIT_PER_MIN', 600),
  },
  push: {
    vapidPublicKey: env('VAPID_PUBLIC_KEY', ''),
    vapidPrivateKey: env('VAPID_PRIVATE_KEY', ''),
    vapidSubject: env('VAPID_SUBJECT', 'mailto:contato@entregaja.dev'),
    expoUrl: env('EXPO_PUSH_URL', 'https://exp.host/--/api/v2/push/send'),
    expoAccessToken: env('EXPO_ACCESS_TOKEN', ''),
  },
};

export const runsHttp = config.role !== 'worker';
export const runsWorkers = config.role !== 'api';
