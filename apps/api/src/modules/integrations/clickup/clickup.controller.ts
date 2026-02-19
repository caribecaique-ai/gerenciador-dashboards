import { Controller, Get, Query, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthGuard } from '../../../auth/guards/auth.guard';
import { ClickupService } from './clickup.service';

@Controller('integrations/clickup')
export class ClickupController {
    constructor(
        private readonly configService: ConfigService,
        private readonly clickupService: ClickupService
    ) { }

    @Get('auth-url')
    @UseGuards(AuthGuard)
    async getAuthUrl() {
        const clientId = this.configService.get('CLICKUP_CLIENT_ID');
        const redirectUri = this.configService.get('CLICKUP_REDIRECT_URI');

        // Scopes default to basic, can be expanded
        return {
            url: `https://app.clickup.com/api?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`
        };
    }

    @Get('callback')
    async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
        if (!code) {
            return res.status(400).send('No code provided');
        }

        try {
            await this.clickupService.exchangeCodeForToken(code);
            // Redirect to frontend success page
            return res.redirect(`${this.configService.get('APP_BASE_URL')}/central?clickup_success=true`);
        } catch (e) {
            return res.status(500).send('Failed to connect ClickUp');
        }
    }
}
