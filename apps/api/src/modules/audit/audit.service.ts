import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
    constructor(private readonly prisma: PrismaService) { }

    async log(action: string, targetType: string, targetId: string, tenantId: string, userId?: string, diff?: any) {
        return this.prisma.auditLog.create({
            data: {
                action,
                targetType,
                targetId,
                tenantId,
                userId,
                diff,
                ip: '127.0.0.1', // Placeholder
            }
        });
    }
}
