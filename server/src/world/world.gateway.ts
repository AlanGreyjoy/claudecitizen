import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer as NativeWebSocketServer } from 'ws';
import { WorldService } from './world.service';

@WebSocketGateway({ path: '/world', perMessageDeflate: false })
export class WorldGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleDestroy
{
  @WebSocketServer()
  private server!: NativeWebSocketServer;

  private snapshotTimer: NodeJS.Timeout | null = null;

  constructor(private readonly world: WorldService) {}

  afterInit(): void {
    this.snapshotTimer = setInterval(() => this.world.broadcastSnapshots(), 50);
    this.snapshotTimer.unref();
  }

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    void this.world.connect(client, request);
  }

  handleDisconnect(client: WebSocket): void {
    this.world.disconnect(client);
  }

  onModuleDestroy(): void {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.server.close();
  }
}
