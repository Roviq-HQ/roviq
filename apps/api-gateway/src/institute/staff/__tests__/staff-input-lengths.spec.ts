import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateStaffInput } from '../dto/create-staff.input';
import { UpdateStaffInput } from '../dto/update-staff.input';

// staff_profiles.department is varchar(50); a longer value must be refused here, not by PostgreSQL.
describe.each([
  ['CreateStaffInput', () => new CreateStaffInput()],
  ['UpdateStaffInput', () => new UpdateStaffInput()],
])('%s department length', (_name, make) => {
  const departmentErrors = async (department: string) => {
    const input = make();
    input.department = department;
    const errors = await validate(input);
    return errors.filter((error) => error.property === 'department');
  };

  it('accepts 50 characters', async () => {
    expect(await departmentErrors('d'.repeat(50))).toEqual([]);
  });

  it('refuses 51 characters', async () => {
    expect(await departmentErrors('d'.repeat(51))).toHaveLength(1);
  });
});
