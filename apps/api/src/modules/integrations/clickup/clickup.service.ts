import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ClickupService {
    constructor(
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
    ) { }

    async exchangeCodeForToken(code: string) {
        const clientId = this.configService.get('CLICKUP_CLIENT_ID');
        const clientSecret = this.configService.get('CLICKUP_CLIENT_SECRET');

        try {
            const response = await axios.post(`https://api.clickup.com/api/v2/oauth/token`, {}, {
                params: {
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: code,
                },
            });

            const { access_token } = response.data;

            // Get User Info to associate with Tenant (simplified for MVP)
            const userRes = await axios.get('https://api.clickup.com/api/v2/user', {
                headers: { Authorization: access_token }
            });

            const clickUpUser = userRes.data.user;

            // For MVP, we attach this token to the first found tenant or handle it more dynamically
            // Here we will just log it or save it to a specific connection record
            console.log('Connected ClickUp User:', clickUpUser.email);

            // Save logic would go here, e.g., finding the tenant by state or user session
            // For now, returning token for manual handling or storing globally for single-tenant setup
            return access_token;

        } catch (e) {
            console.error('ClickUp Oauth Error', e.response?.data || e.message);
            throw new InternalServerErrorException('Failed to exchange token');
        }
    }
}
