import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ClickupModule } from './modules/integrations/clickup/clickup.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AuditModule } from './modules/audit/audit.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuthModule,
        ClientsModule,
        ClickupModule,
        TelemetryModule,
        AlertsModule,
        AuditModule,
        RealtimeModule,
    ],
})
export class AppModule { }
