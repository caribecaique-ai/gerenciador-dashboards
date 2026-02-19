import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@Controller('alerts')
@UseGuards(AuthGuard, TenantGuard)
export class AlertsController {
    constructor(private readonly alertsService: AlertsService) { }

    @Get()
    async getAlerts() {
        return [];
    }
}
