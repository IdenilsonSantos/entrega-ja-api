/**
 * Horário de funcionamento (função pura, roda sobre o build).
 *   npm run build && npm run test:unit
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { openState, isValidTimeZone } = createRequire(import.meta.url)('../../dist/modules/stores/opening-hours.js');

// 2026-11-02 é uma segunda-feira. São Paulo está em UTC-3 (sem horário de verão).
const sp = (isoLocal) => new Date(`${isoLocal}-03:00`);
const store = (openingHours, isOpen = true, timezone = 'America/Sao_Paulo') => ({ isOpen, openingHours, timezone });
const everyDay = (open, close) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));

test('sem horário, vale só o botão', () => {
  assert.deepEqual(openState(store(null, true)), { openNow: true, opensAt: null, closesAt: null });
  assert.deepEqual(openState(store([], false)), { openNow: false, opensAt: null, closesAt: null });
});

test('botão desligado pausa mesmo dentro do horário', () => {
  assert.equal(openState(store(everyDay('08:00', '22:00'), false), sp('2026-11-02T12:00')).openNow, false);
});

test('dentro do horário: aberta, com a hora de fechar', () => {
  const s = openState(store(everyDay('08:00', '22:00')), sp('2026-11-02T12:00'));
  assert.equal(s.openNow, true);
  assert.equal(s.closesAt, sp('2026-11-02T22:00').toISOString());
});

test('antes de abrir: fechada, com a hora de abrir', () => {
  const s = openState(store(everyDay('08:00', '22:00')), sp('2026-11-02T07:30'));
  assert.equal(s.openNow, false);
  assert.equal(s.opensAt, sp('2026-11-02T08:00').toISOString());
});

test('fechamento é exclusivo: às 22:00 já fechou e abre no dia seguinte', () => {
  const s = openState(store(everyDay('08:00', '22:00')), sp('2026-11-02T22:00'));
  assert.equal(s.openNow, false);
  assert.equal(s.opensAt, sp('2026-11-03T08:00').toISOString());
});

test('faixa que passa da meia-noite continua aberta de madrugada', () => {
  const hours = [{ day: 5, open: '18:00', close: '02:00' }]; // sexta 18h → sábado 2h
  assert.equal(openState(store(hours), sp('2026-11-07T01:30')).openNow, true); // sábado 1h30
  assert.equal(openState(store(hours), sp('2026-11-07T01:30')).closesAt, sp('2026-11-07T02:00').toISOString());
  assert.equal(openState(store(hours), sp('2026-11-07T02:30')).openNow, false);
});

test('sábado à noite emenda no domingo de madrugada (virada da semana)', () => {
  const hours = [{ day: 6, open: '20:00', close: '00:00' }, { day: 0, open: '00:00', close: '03:00' }];
  const s = openState(store(hours), sp('2026-11-07T23:00')); // sábado 23h
  assert.equal(s.openNow, true);
  assert.equal(s.closesAt, sp('2026-11-08T03:00').toISOString());
  assert.equal(openState(store(hours), sp('2026-11-08T02:00')).openNow, true); // domingo 2h
});

test('dois turnos no dia: entre eles, abre no turno da noite', () => {
  const hours = [{ day: 1, open: '11:00', close: '15:00' }, { day: 1, open: '18:00', close: '23:00' }];
  const s = openState(store(hours), sp('2026-11-02T16:00'));
  assert.equal(s.openNow, false);
  assert.equal(s.opensAt, sp('2026-11-02T18:00').toISOString());
});

test('próxima abertura dá a volta na semana', () => {
  const hours = [{ day: 1, open: '09:00', close: '10:00' }]; // só segunda
  const s = openState(store(hours), sp('2026-11-02T11:00'));
  assert.equal(s.opensAt, sp('2026-11-09T09:00').toISOString());
});

test('24 horas todos os dias: aberta e sem hora de fechar', () => {
  const s = openState(store(everyDay('00:00', '00:00')), sp('2026-11-04T03:00'));
  assert.deepEqual(s, { openNow: true, opensAt: null, closesAt: null });
});

test('respeita o fuso da loja', () => {
  // 12:00 em São Paulo = 11:00 em Manaus (UTC-4): loja de Manaus abre às 11:30
  const s = openState(store(everyDay('11:30', '22:00'), true, 'America/Manaus'), sp('2026-11-02T12:00'));
  assert.equal(s.openNow, false);
  assert.equal(s.opensAt, sp('2026-11-02T12:30').toISOString());
});

test('valida fuso horário', () => {
  assert.equal(isValidTimeZone('America/Sao_Paulo'), true);
  assert.equal(isValidTimeZone('Marte/Base'), false);
});
