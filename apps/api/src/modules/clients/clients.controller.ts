import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('clients')
@UseGuards(AuthGuard, TenantGuard)
export class ClientsController {
    constructor(private readonly clientsService: ClientsService) { }

    @Post()
    @Roles(Role.ADMIN, Role.OPS)
    create(@Body() createClientDto: any, @Request() req: any) {
        return this.clientsService.create(createClientDto, req.tenantId);
    }

    @Get()
    findAll(@Request() req: any) {
        return this.clientsService.findAll(req.tenantId);
    }

    @Get(':id')
    findOne(@Param('id') id: string, @Request() req: any) {
        return this.clientsService.findOne(id, req.tenantId);
    }

    @Post(':id/rotate-url')
    @Roles(Role.ADMIN, Role.OPS)
    rotateUrl(@Param('id') id: string, @Request() req: any) {
        return this.clientsService.rotateUrl(id, req.tenantId);
    }

    @Post(':id/sync-now')
    @Roles(Role.ADMIN, Role.OPS, Role.SALES)
    syncNow(@Param('id') id: string, @Request() req: any) {
        return this.clientsService.syncNow(id, req.tenantId);
    }

    @Delete(':id')
    @Roles(Role.ADMIN)
    remove(@Param('id') id: string, @Request() req: any) {
        return this.clientsService.remove(id, req.tenantId);
    }
}
