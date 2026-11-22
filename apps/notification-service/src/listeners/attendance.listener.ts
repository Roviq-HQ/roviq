import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';
import { type AttendanceAbsentEvent, NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import {
  instituteAudience,
  RecipientResolver,
  sourceOf,
} from '../services/recipient-resolver.service';
import { attendanceAbsentDedupeKey } from '../types/attendance-absent.type';

@Controller()
export class AttendanceListener {
  private readonly logger = new Logger(AttendanceListener.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly recipients: RecipientResolver,
  ) {}

  @EventPattern(NOTIFICATION_SUBJECTS.ATTENDANCE_ABSENT, {
    stream: 'NOTIFICATION',
    durable: 'notification-attendance',
  })
  async handleAbsent(
    @Payload() event: AttendanceAbsentEvent,
    @Ctx() ctx: JetStreamContext,
  ): Promise<void> {
    const guardians = await this.recipients.guardiansOfStudent(event.tenantId, event.studentId);
    if (guardians.length === 0) {
      this.logger.warn(
        `No linked guardian for student membership "${event.studentId}" in institute "${event.tenantId}"; attendance alert not sent`,
      );
      return;
    }
    const params = {
      sessionId: event.sessionId,
      studentId: event.studentId,
      studentName: event.studentName ?? null,
      status: event.status,
      markedAt: event.markedAt,
      sessionDate: event.sessionDate ?? null,
      sectionName: event.sectionName ?? null,
      standardName: event.standardName ?? null,
    };
    for (const recipient of guardians) {
      await this.dispatcher.dispatch({
        message: { type: 'ATTENDANCE_ABSENT', params },
        audience: instituteAudience(event.tenantId),
        recipient,
        source: sourceOf(ctx),
        dedupeKey: attendanceAbsentDedupeKey(params, recipient.userId),
        inApp: true,
      });
    }
  }
}
