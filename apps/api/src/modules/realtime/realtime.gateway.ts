import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
})
export class RealtimeGateway {
    @WebSocketServer()
    server: Server;

    @SubscribeMessage('join-tenant')
    handleJoinTenant(@MessageBody() data: { tenantId: string }, @ConnectedSocket() client: Socket) {
        if (data.tenantId) {
            client.join(`tenant:${data.tenantId}`);
            console.log(`Client ${client.id} joined tenant:${data.tenantId}`);
        }
    }

    // Method to emit updates
    emitToTenant(tenantId: string, event: string, payload: any) {
        this.server.to(`tenant:${tenantId}`).emit(event, payload);
    }
}
