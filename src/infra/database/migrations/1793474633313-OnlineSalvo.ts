import { MigrationInterface, QueryRunner } from "typeorm";

export class OnlineSalvo1793474633313 implements MigrationInterface {
    name = 'OnlineSalvo1793474633313'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "courier_profiles" ADD "wantsOnline" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "courier_profiles" DROP COLUMN "wantsOnline"`);
    }

}
