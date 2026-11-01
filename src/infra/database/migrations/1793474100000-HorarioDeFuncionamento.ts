import { MigrationInterface, QueryRunner } from "typeorm";

export class HorarioDeFuncionamento1793474100000 implements MigrationInterface {
    name = 'HorarioDeFuncionamento1793474100000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stores" ADD "openingHours" jsonb`);
        await queryRunner.query(`ALTER TABLE "stores" ADD "timezone" character varying(40) NOT NULL DEFAULT 'America/Sao_Paulo'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "timezone"`);
        await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "openingHours"`);
    }

}
