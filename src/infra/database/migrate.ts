import dataSource from './data-source';

/** Aplica as migrations que faltam (roda antes de cada versão nova entrar no ar). */
async function main() {
  await dataSource.initialize();
  const done = await dataSource.runMigrations({ transaction: 'each' });
  console.log(done.length ? `Migrations aplicadas: ${done.map((m) => m.name).join(', ')}` : 'Banco já está atualizado');
  await dataSource.destroy();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
