import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AlertsService {
    constructor(private readonly prisma: PrismaService) { }

    // Logic to check rules
}
