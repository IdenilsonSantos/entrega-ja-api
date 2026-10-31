import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { badRequest } from './errors';

/**
 * Paginação por cursor (keyset).
 *
 * A lista é ordenada por (coluna, id) e o cursor guarda a última chave da página.
 * A próxima página pede "tudo depois desta chave": usa índice, custa o mesmo na página 1 e
 * na 100, e não repete nem pula itens quando entram registros novos durante a navegação.
 *
 * Contrato: ?limit=20&cursor=<opaco> → { items, nextCursor }
 */
export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const DEFAULT_LIMIT = 20;

const encode = (key: string, id: string) => Buffer.from(JSON.stringify([key, id])).toString('base64url');

function decode(cursor?: string): { key: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [key, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof key !== 'string' || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error();
    return { key, id };
  } catch {
    throw badRequest('Cursor inválido');
  }
}

/**
 * Aplica cursor, ordem e limite e devolve a página.
 * A chave sai do banco como texto (col::text) para manter os microssegundos do timestamp:
 * um Date do JavaScript os perderia e a próxima página poderia pular itens.
 */
export async function paginate<T extends ObjectLiteral & { id: string }>(
  qb: SelectQueryBuilder<T>,
  q: PageQuery,
  column = 'createdAt',
  dir: 'ASC' | 'DESC' = 'DESC',
): Promise<Page<T>> {
  const limit = q.limit ?? DEFAULT_LIMIT;
  const a = qb.alias;
  const col = `${a}."${column}"`;
  const c = decode(q.cursor);
  if (c) qb.andWhere(`(${col}, ${a}.id) ${dir === 'DESC' ? '<' : '>'} (:__ck, :__cid)`, { __ck: c.key, __cid: c.id });
  qb.addSelect(`${col}::text`, '__ck').orderBy(`${a}.${column}`, dir).addOrderBy(`${a}.id`, dir).take(undefined).limit(limit + 1);
  const { entities, raw } = await qb.getRawAndEntities();
  const keys = new Map<string, string>(raw.map((r) => [r[`${a}_id`], r.__ck]));
  const items = entities.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: entities.length > limit && last ? encode(keys.get(last.id)!, last.id) : null };
}

/** Mesma página com os itens transformados (ex.: para esconder campos). */
export const mapPage = <T, U>(p: Page<T>, fn: (t: T) => U): Page<U> => ({ items: p.items.map(fn), nextCursor: p.nextCursor });
