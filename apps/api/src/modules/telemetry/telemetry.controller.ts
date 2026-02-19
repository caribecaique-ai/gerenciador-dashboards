import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';

@Controller('public/telemetry')
export class TelemetryController {
    constructor(private readonly telemetryService: TelemetryService) { }

    @Post('heartbeat')
    async heartbeat(@Body() data: { token: string; latency?: number; errors?: number }) {
        return this.telemetryService.handleHeartbeat(data);
    }

    @Post('event')
    async logEvent(@Body() data: { token: string; type: string; payload: any }) {
        return this.telemetryService.handleUsageEvent(data);
    }
}
