import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { LeaveStatus, LeaveType } from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import { FileRefModel } from '../../../files/models/file-ref.model';

registerEnumType(LeaveType, {
  name: 'LeaveType',
  description: 'Category of leave — MEDICAL, CASUAL, BEREAVEMENT, EXAM or OTHER.',
});

registerEnumType(LeaveStatus, {
  name: 'LeaveStatus',
  description: 'Workflow state of a leave application (PENDING → APPROVED/REJECTED/CANCELLED).',
});

@ObjectType({
  description:
    'A leave application for a student or staff member. When status=APPROVED and the date is in range, attendance seeds LEAVE for the student.',
})
export class LeaveModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { description: 'Membership id the leave belongs to.' })
  userId!: string;

  @Field(() => String, { description: 'Inclusive start date as ISO YYYY-MM-DD.' })
  startDate!: string;

  @Field(() => String, { description: 'Inclusive end date as ISO YYYY-MM-DD.' })
  endDate!: string;

  @Field(() => LeaveType)
  type!: LeaveType;

  @Field(() => String)
  reason!: string;

  @Field(() => LeaveStatus)
  status!: LeaveStatus;

  @Field(() => [FileRefModel], {
    description: 'Supporting documents (e.g. medical certificate), oldest first.',
  })
  files!: FileRefModel[];

  @Field(() => ID, { nullable: true, description: 'Membership id that approved or rejected.' })
  decidedBy!: string | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}
