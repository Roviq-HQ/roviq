import type { InstituteAddress, InstituteContact } from '@roviq/database';

export interface InstituteGroupRecord {
  id: string;
  name: string;
  code: string;
  type: string;
  registrationNumber: string | null;
  registrationState: string | null;
  contact: InstituteContact;
  address: InstituteAddress | null;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInstituteGroupData {
  name: string;
  code: string;
  type: string;
  registrationNumber?: string;
  registrationState?: string;
  contact?: InstituteContact;
  address?: InstituteAddress;
}

export interface UpdateInstituteGroupData {
  name?: string;
  registrationNumber?: string;
  registrationState?: string;
  contact?: InstituteContact;
  address?: InstituteAddress;
}

export interface InstituteGroupSearchParams {
  search?: string;
  status?: string;
  type?: string;
  first?: number;
  after?: string;
}

export interface GroupMembershipRecord {
  id: string;
  userId: string;
  groupId: string;
  roleId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
