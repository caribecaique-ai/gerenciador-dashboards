import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClientsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(data: any, tenantId: string) {
        return this.prisma.client.create({
            data: {
                ...data,
                tenantId,
            },
        });
    }

    async findAll(tenantId: string) {
        return this.prisma.client.findMany({
            where: { tenantId },
            include: {
                dashboards: true,
            }
        });
    }

    async findOne(id: string, tenantId: string) {
        const client = await this.prisma.client.findFirst({
            where: { id, tenantId },
            include: {
                dashboards: true,
                metrics: { take: 10, orderBy: { createdAt: 'desc' } }
            }
        });

        if (!client) throw new NotFoundException('Client not found');
        return client;
    }

    async rotateUrl(id: string, tenantId: string) {
        // Generate new token
        const newToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        // Deactivate old one (or just create new DashboardInstance)
        return this.prisma.dashboardInstance.create({
            data: {
                token: newToken,
                clientId: id,
                tenantId,
            }
        });
    }

    async remove(id: string, tenantId: string) {
        // Soft delete or hard delete
        return this.prisma.client.deleteMany({
            where: { id, tenantId }
        });
    }

    async syncNow(id: string, tenantId: string) {
        // Should trigger BullMQ job
        console.log(`Triggering Sync for Client ${id} in Tenant ${tenantId}`);
        return { status: 'queued' };
    }
}
