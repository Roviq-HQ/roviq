'use client';

import { useAuth } from '@roviq/auth';
import { GROUP_TYPE_VALUES } from '@roviq/common-types';
import { extractGraphQLError, extractGraphQLErrorCode } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import {
  Button,
  Can,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Building2, FolderOpen, Loader2, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import {
  useResellerAddInstituteToGroup,
  useResellerCreateInstituteGroup,
  useResellerInstituteGroups,
  useResellerInstitutes,
  useResellerRemoveInstituteFromGroup,
} from '../institutes/use-reseller-institutes';

const { resellerGroups } = testIds;

export default function InstituteGroupsPage() {
  const t = useTranslations('resellerInstitutes.groups');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [groupType, setGroupType] = React.useState<string>('TRUST');
  const [registrationNumber, setRegistrationNumber] = React.useState('');
  const [registrationState, setRegistrationState] = React.useState('');

  const { data, loading } = useResellerInstituteGroups();
  const [createGroup, { loading: creating }] = useResellerCreateInstituteGroup();
  const { user } = useAuth();
  const resolveI18n = useI18nField();
  const { institutes } = useResellerInstitutes({ first: 100 });
  const [addInstitute, { loading: adding }] = useResellerAddInstituteToGroup();
  const [targetGroup, setTargetGroup] = React.useState<{ id: string; name: string } | null>(null);
  const [instituteId, setInstituteId] = React.useState('');

  const [removeInstitute, { loading: removing }] = useResellerRemoveInstituteFromGroup();
  const members = institutes.filter((institute) => institute.groupId === targetGroup?.id);
  const candidates = institutes.filter((institute) => institute.groupId !== targetGroup?.id);

  const handleRemoveInstitute = async (id: string) => {
    try {
      await removeInstitute({ variables: { instituteId: id } });
      toast.success(t('addInstitute.removeSuccess'));
    } catch {
      toast.error(t('addInstitute.removeError'));
    }
  };

  const closeAddDialog = () => {
    setTargetGroup(null);
    setInstituteId('');
  };

  const handleAddInstitute = async () => {
    if (!targetGroup || !instituteId) return;
    try {
      await addInstitute({ variables: { instituteId, groupId: targetGroup.id } });
      toast.success(t('addInstitute.success'));
      setInstituteId('');
    } catch (err) {
      const notAllowed = extractGraphQLErrorCode(err) === 'INSTITUTE_NOT_FOUND';
      toast.error(t(notAllowed ? 'addInstitute.notAllowed' : 'addInstitute.error'));
    }
  };

  const groups = data?.resellerListInstituteGroups?.edges?.map((e) => e.node) ?? [];

  const handleCreate = async () => {
    try {
      await createGroup({
        variables: {
          input: {
            name,
            code,
            type: groupType,
            ...(registrationNumber ? { registrationNumber } : {}),
            ...(registrationState ? { registrationState } : {}),
          },
        },
      });
      toast.success(t('create.success'));
      setDialogOpen(false);
      setName('');
      setCode('');
      setRegistrationNumber('');
      setRegistrationState('');
    } catch (err) {
      toast.error(t('create.error'), { description: extractGraphQLError(err, t('create.error')) });
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Can I="create" a="InstituteGroup">
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            {t('createGroup')}
          </Button>
        </Can>
      </div>

      {groups.length === 0 ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>{t('empty.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.name')}</TableHead>
                  <TableHead>{t('columns.code')}</TableHead>
                  <TableHead>{t('columns.type')}</TableHead>
                  <TableHead>{t('registrationNumber')}</TableHead>
                  <TableHead>{t('columns.count')}</TableHead>
                  <TableHead>{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow
                    key={String(group.id)}
                    data-testid={resellerGroups.row(String(group.id))}
                  >
                    <TableCell className="font-medium">{String(group.name ?? '')}</TableCell>
                    <TableCell className="font-mono text-xs">{String(group.code ?? '')}</TableCell>
                    <TableCell>{String(group.type ?? '')}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {String(group.registrationNumber ?? '\u2014')}
                    </TableCell>
                    <TableCell>{String(group.instituteCount ?? '0')}</TableCell>
                    <TableCell>
                      {group.resellerId && group.resellerId === user?.resellerId ? (
                        <Can I="manage" a="InstituteGroup">
                          <Button
                            variant="outline"
                            size="sm"
                            title={t('addInstitute.button')}
                            data-testid={resellerGroups.addInstituteBtn(String(group.id))}
                            onClick={() =>
                              setTargetGroup({ id: String(group.id), name: String(group.name) })
                            }
                          >
                            <Building2 className="size-4" />
                            {t('addInstitute.button')}
                          </Button>
                        </Can>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {t('managedByPlatform')}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('create.title')}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>{t('create.name')}</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('create.namePlaceholder')}
              />
            </Field>
            <Field>
              <FieldLabel>{t('create.code')}</FieldLabel>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('create.codePlaceholder')}
              />
            </Field>
            <Field>
              <FieldLabel>{t('create.type')}</FieldLabel>
              <Select value={groupType} onValueChange={setGroupType}>
                <SelectTrigger>
                  <SelectValue placeholder={t('create.typePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_TYPE_VALUES.map((gt) => (
                    <SelectItem key={gt} value={gt}>
                      {gt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('registrationNumber')}</FieldLabel>
              <Input
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder={t('registrationNumberPlaceholder')}
              />
            </Field>
            <Field>
              <FieldLabel>{t('registrationState')}</FieldLabel>
              <Input
                value={registrationState}
                onChange={(e) => setRegistrationState(e.target.value)}
                placeholder={t('registrationStatePlaceholder')}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={creating || !name || !code}>
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('create.creating')}
                </>
              ) : (
                t('create.submit')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={targetGroup !== null} onOpenChange={(open) => !open && closeAddDialog()}>
        <DialogContent className="sm:max-w-[420px]" data-testid={resellerGroups.addInstituteDialog}>
          <DialogHeader>
            <DialogTitle>{t('addInstitute.title', { group: targetGroup?.name ?? '' })}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>{t('addInstitute.members')}</FieldLabel>
              {members.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('addInstitute.noMembers')}</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {members.map((institute) => (
                    <li
                      key={institute.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      data-testid={resellerGroups.member(institute.id)}
                    >
                      <span>{resolveI18n(institute.name)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('addInstitute.remove')}
                        disabled={removing}
                        data-testid={resellerGroups.removeInstituteBtn(institute.id)}
                        onClick={() => handleRemoveInstitute(institute.id)}
                      >
                        <X className="size-4" />
                        {t('addInstitute.remove')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            <Field>
              <FieldLabel>{t('addInstitute.institute')}</FieldLabel>
              {candidates.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('addInstitute.noInstitutes')}</p>
              ) : (
                <Select value={instituteId} onValueChange={setInstituteId}>
                  <SelectTrigger data-testid={resellerGroups.addInstituteSelect}>
                    <SelectValue placeholder={t('addInstitute.institutePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((institute) => (
                      <SelectItem key={institute.id} value={institute.id}>
                        {resolveI18n(institute.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              onClick={handleAddInstitute}
              disabled={adding || !instituteId}
              data-testid={resellerGroups.addInstituteSubmit}
            >
              {adding ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('addInstitute.adding')}
                </>
              ) : (
                t('addInstitute.submit')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
