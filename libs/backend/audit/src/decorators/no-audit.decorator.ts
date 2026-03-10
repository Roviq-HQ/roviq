import { Reflector } from '@nestjs/core';

export const NoAudit = Reflector.createDecorator<true>();
