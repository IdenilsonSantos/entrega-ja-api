import { MigrationInterface, QueryRunner } from "typeorm";

export class AutomacaoDaLoja1793475619854 implements MigrationInterface {
    name = 'AutomacaoDaLoja1793475619854'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stores" ADD "autoAccept" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "stores" ADD "autoReady" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "autoReady"`);
        await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "autoAccept"`);
    }

}
