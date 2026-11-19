import type { LeaveStatus, LeaveType } from '@roviq/common-types';
import type { FileRecord } from '../../../files/repositories/types';

export interface LeaveRecord {
  id: string;
  tenantId: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: LeaveType;
  reason: string;
  status: LeaveStatus;
  /** Supporting documents, oldest first. */
  files: FileRecord[];
  decidedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLeaveData {
  userId: string;
  startDate: string;
  endDate: string;
  type: LeaveType;
  reason: string;
  /** Verified uploads to attach (see FileService.verifyUploads). */
  fileIds: string[];
}

export interface UpdateLeaveData {
  startDate?: string;
  endDate?: string;
  type?: LeaveType;
  reason?: string;
  /** Full new set of attachments. Omitted: attachments stay as they are. */
  fileIds?: string[];
}

export interface LeaveListQuery {
  userId?: string;
  status?: LeaveStatus;
  type?: LeaveType;
  startDate?: string;
  endDate?: string;
}

export interface LeaveOnDateQuery {
  date: string;
  userIds: string[];
}
