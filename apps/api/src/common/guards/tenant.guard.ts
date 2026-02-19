import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user; // Set by AuthGuard

        if (!user || !user.tenantId) {
            throw new ForbiddenException('User is not associated with a tenant');
        }

        // Attach tenantId to request for easy access in controllers
        request.tenantId = user.tenantId;
        return true;
    }
}
