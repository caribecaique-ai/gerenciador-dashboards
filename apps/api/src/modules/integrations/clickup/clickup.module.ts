import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ClickupService } from './clickup.service';
import { ClickupController } from './clickup.controller';

@Module({
    imports: [ConfigModule, PrismaModule],
    controllers: [ClickupController],
    providers: [ClickupService],
    exports: [ClickupService],
})
export class ClickupModule { }
