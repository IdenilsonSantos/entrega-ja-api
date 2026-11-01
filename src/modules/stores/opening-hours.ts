/**
 * Horário de funcionamento da loja.
 *
 * Cada faixa é um dia da semana (0 = domingo) com abertura e fechamento "HH:MM" no fuso da loja.
 * Fechamento menor ou igual à abertura passa da meia-noite ("18:00"–"02:00"; "00:00" fecha à meia-noite).
 * Um dia pode ter várias faixas (almoço e jantar). Sem faixas, vale só o botão de abrir e fechar.
 *
 * A loja recebe pedidos quando o botão está ligado E está dentro do horário: com horário, o dono deixa
 * o botão ligado e a loja abre e fecha sozinha; desligar o botão serve para pausar no meio do expediente.
 */
export interface OpeningRange {
  day: number;
  open: string;
  close: string;
}

const WEEK = 7 * 24 * 60;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Minuto da semana (0 = domingo 00:00) no fuso informado */
function weekMinute(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return day * 1440 + Number(get('hour')) * 60 + Number(get('minute'));
}

/**
 * Faixas em minutos, repetidas na semana anterior e na seguinte, ordenadas e unidas quando se
 * encostam. Assim o sábado à noite emenda no domingo de madrugada sem caso especial.
 */
function intervals(ranges: OpeningRange[]) {
  const list = ranges
    .flatMap((r) => {
      const start = r.day * 1440 + minutes(r.open);
      let end = r.day * 1440 + minutes(r.close);
      if (end <= start) end += 1440;
      return [-WEEK, 0, WEEK].map((shift) => [start + shift, end + shift] as [number, number]);
    })
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of list) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * Situação agora: se recebe pedidos e quando muda.
 * opensAt só vem quando está fechada pelo horário (com o botão ligado); closesAt quando está aberta
 * pelo horário e fecha em algum momento (loja 24 horas não tem closesAt).
 */
export function openState(store: { isOpen: boolean; openingHours: OpeningRange[] | null; timezone: string }, now = new Date()) {
  const ranges = store.openingHours ?? [];
  if (!ranges.length) return { openNow: store.isOpen, opensAt: null, closesAt: null };
  if (!store.isOpen) return { openNow: false, opensAt: null, closesAt: null };

  const w = weekMinute(now, store.timezone);
  const at = (deltaMin: number) => new Date(Math.floor(now.getTime() / 60_000) * 60_000 + deltaMin * 60_000).toISOString();
  const list = intervals(ranges);
  const current = list.find(([s, e]) => s <= w && w < e);
  if (current) return { openNow: true, opensAt: null, closesAt: current[1] - w >= WEEK ? null : at(current[1] - w) };
  const next = list.find(([s]) => s > w)!;
  return { openNow: false, opensAt: at(next[0] - w), closesAt: null };
}
