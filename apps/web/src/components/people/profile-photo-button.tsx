'use client';

import { extractGraphQLErrorCode, gql, useApolloClient, useMutation } from '@roviq/graphql';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileUpload } from '@web/components/file-upload/file-upload';
import { fileUploadErrorKey } from '@web/components/file-upload/use-file-upload';
import { Camera } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

const { profilePhoto: ids } = testIds;

const SET_STUDENT_PHOTO = gql`
  mutation SetStudentPhoto($id: ID!, $fileId: ID) {
    setStudentPhoto(studentProfileId: $id, fileId: $fileId)
  }
`;
const SET_STAFF_PHOTO = gql`
  mutation SetStaffPhoto($id: ID!, $fileId: ID) {
    setStaffPhoto(staffProfileId: $id, fileId: $fileId)
  }
`;
const SET_GUARDIAN_PHOTO = gql`
  mutation SetGuardianPhoto($id: ID!, $fileId: ID) {
    setGuardianPhoto(guardianProfileId: $id, fileId: $fileId)
  }
`;
const SET_MY_PROFILE_PHOTO = gql`
  mutation SetMyProfilePhoto($fileId: ID) {
    setMyProfilePhoto(fileId: $fileId)
  }
`;

const MUTATION = {
  student: SET_STUDENT_PHOTO,
  staff: SET_STAFF_PHOTO,
  guardian: SET_GUARDIAN_PHOTO,
  self: SET_MY_PROFILE_PHOTO,
} as const;

export interface ProfilePhotoButtonProps {
  /** Whose picture: a student, staff member or guardian of this institute, or the signed-in user. */
  kind: keyof typeof MUTATION;
  /** Id of the student, staff or guardian profile. Not used for `self`. */
  profileId?: string;
  /** The person's user id; the uploaded picture is stored as theirs. */
  userId: string;
  name: string;
  hasPhoto: boolean;
}

/** "Change photo" with a crop step. Wrap it in `<Can>` for anyone but the person themselves. */
export function ProfilePhotoButton({
  kind,
  profileId,
  userId,
  name,
  hasPhoto,
}: ProfilePhotoButtonProps) {
  const t = useTranslations('fileUpload');
  const client = useApolloClient();
  const [open, setOpen] = React.useState(false);
  const [fileId, setFileId] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [setPhoto, { loading }] = useMutation<unknown, { id?: string; fileId: string | null }>(
    MUTATION[kind],
  );

  const save = async (next: string | null) => {
    try {
      await setPhoto({ variables: { id: profileId, fileId: next } });
      toast.success(next ? t('photo.saved') : t('photo.removed'));
      setOpen(false);
      setFileId(null);
      // The picture shows in lists and headers alike; reload whatever is on screen.
      await client.refetchQueries({ include: 'active' });
    } catch (error) {
      const key = fileUploadErrorKey(extractGraphQLErrorCode(error));
      toast.error(key ? t(`errors.${key}`, { count: 1 }) : t('photo.failed'));
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        title={t('photo.change')}
        onClick={() => setOpen(true)}
        data-testid={ids.changeBtn}
      >
        <Camera className="size-4" aria-hidden="true" />
        {t('photo.change')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFileId(null);
        }}
      >
        <DialogContent data-testid={ids.dialog}>
          <DialogHeader>
            <DialogTitle>{t('photo.title', { name })}</DialogTitle>
            <DialogDescription>{t('photo.description')}</DialogDescription>
          </DialogHeader>
          <FileUpload
            name="profile-photo"
            purpose="PROFILE_PHOTO"
            label={t('photo.label')}
            crop="square"
            subjectUserId={userId}
            onChange={(fileIds) => setFileId(fileIds[0] ?? null)}
            onBusyChange={setUploading}
          />
          <DialogFooter>
            {hasPhoto ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive sm:me-auto"
                title={t('photo.remove')}
                disabled={loading}
                onClick={() => void save(null)}
                data-testid={ids.removeBtn}
              >
                {t('photo.remove')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              title={t('photo.cancel')}
              onClick={() => setOpen(false)}
              data-testid={ids.cancelBtn}
            >
              {t('photo.cancel')}
            </Button>
            <Button
              type="button"
              title={t('photo.save')}
              disabled={!fileId || uploading || loading}
              onClick={() => void save(fileId)}
              data-testid={ids.saveBtn}
            >
              {loading ? t('photo.saving') : t('photo.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
