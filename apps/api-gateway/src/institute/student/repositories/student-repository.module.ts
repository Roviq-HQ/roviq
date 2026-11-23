import { Module } from '@nestjs/common';
import { StudentDrizzleRepository } from './student.drizzle-repository';
import { StudentRepository } from './student.repository';
import { StudentAcademicDrizzleRepository } from './student-academic.drizzle-repository';
import { StudentAcademicRepository } from './student-academic.repository';

@Module({
  providers: [
    { provide: StudentRepository, useClass: StudentDrizzleRepository },
    { provide: StudentAcademicRepository, useClass: StudentAcademicDrizzleRepository },
  ],
  exports: [StudentRepository, StudentAcademicRepository],
})
export class StudentRepositoryModule {}
