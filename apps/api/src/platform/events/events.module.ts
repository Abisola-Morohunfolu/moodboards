import { Module } from '@nestjs/common';
import { BoardEventWriter } from './board-event.writer';

@Module({ providers: [BoardEventWriter], exports: [BoardEventWriter] })
export class EventsModule {}
