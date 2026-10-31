import { Global, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { config } from '../../config';
import { badRequest } from '../../common/errors';

export const UPLOAD_ROUTE = '/api/uploads';
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Fotos (produto, logo, capa, avatar). Toda imagem é redimensionada e convertida para WebP:
 * arquivos leves e nenhum formato estranho chega ao navegador.
 * Em várias réplicas, UPLOAD_DIR precisa ser um volume compartilhado (ou troque por S3/R2 aqui).
 */
@Injectable()
export class StorageService {
  async saveImage(file: Express.Multer.File | undefined, size: { width: number; height: number }) {
    if (!file) throw badRequest('Envie uma imagem');
    if (file.size > MAX_BYTES) throw badRequest('A imagem passa de 5 MB');
    let out: Buffer;
    try {
      out = await sharp(file.buffer).rotate().resize({ ...size, fit: 'cover' }).webp({ quality: 80 }).toBuffer();
    } catch {
      throw badRequest('Arquivo de imagem inválido');
    }
    await mkdir(config.uploadDir, { recursive: true });
    const name = `${randomUUID()}.webp`;
    await writeFile(join(config.uploadDir, name), out);
    return `${UPLOAD_ROUTE}/${name}`;
  }

  /** Apaga a foto antiga quando é trocada */
  async remove(url: string | null | undefined) {
    if (!url?.startsWith(UPLOAD_ROUTE + '/')) return;
    const name = url.slice(UPLOAD_ROUTE.length + 1);
    if (!/^[\w-]+\.webp$/.test(name)) return;
    await unlink(join(config.uploadDir, name)).catch(() => undefined);
  }
}

export const IMAGE = {
  product: { width: 800, height: 600 },
  logo: { width: 320, height: 320 },
  cover: { width: 1440, height: 560 },
  avatar: { width: 320, height: 320 },
};

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
