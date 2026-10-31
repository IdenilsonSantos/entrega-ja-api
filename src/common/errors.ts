import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

/** Atalhos para os erros mais usados, com mensagens em português prontas para a tela. */
export const notFound = (what: string) => new NotFoundException(`${what} não encontrado`);
export const forbidden = (msg = 'Você não tem permissão para isso') => new ForbiddenException(msg);
export const badRequest = (msg: string) => new BadRequestException(msg);
export const conflict = (msg: string) => new ConflictException(msg);

/** Remove chaves undefined (campos não enviados num PATCH) */
export const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
