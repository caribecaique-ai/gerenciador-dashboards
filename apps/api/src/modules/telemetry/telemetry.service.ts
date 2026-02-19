import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TelemetryService {
    private readonly logger = new Logger(TelemetryService.name);

    constructor(private readonly prisma: PrismaService) { }

    async handleHeartbeat(data: { token: string; latency?: number; errors?: number }) {
        const dashboard = await this.prisma.dashboardInstance.findUnique({
            where: { token: data.token },
            include: { client: true }
        });

        if (!dashboard) {
            this.logger.warn(`Heartbeat received for unknown token: ${data.token}`);
            return;
        }

        // Save heartbeat to Redis (for Realtime status) or DB (for history)
        // For MVP, simple DB log
        await this.prisma.healthHeartbeat.create({
            data: {
                latency: Math.floor(data.latency || 0),
                errors: data.errors || 0,
                clientId: dashboard.clientId,
            }
        });

        // Update 'lastSeenAt'
        await this.prisma.client.update({
            where: { id: dashboard.clientId },
            data: { lastSeenAt: new Date() }
        });

        return { status: 'acknowledged' };
    }

    async handleUsageEvent(data: { token: string; type: string; payload: any }) {
        const dashboard = await this.prisma.dashboardInstance.findUnique({
            where: { token: data.token },
        });

        if (!dashboard) return;

        await this.prisma.usageEvent.create({
            data: {
                type: data.type,
                data: data.payload,
                clientId: dashboard.clientId,
                tenantId: dashboard.tenantId,
            }
        });

        return { status: 'recorded' };
    }
}
