'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useBreadcrumbOverride,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useAdminUser } from '../use-users';
import { AddressesTab } from './_components/addresses-tab';
import { UserAuditTab } from './_components/audit-tab';
import { DocumentsTab } from './_components/documents-tab';
import { IdentityTab } from './_components/identity-tab';
import { MembershipsTab } from './_components/memberships-tab';
import { ProfileCard, useUserDisplayName } from './_components/profile-card';

const { adminUserDetail } = testIds;

const TABS = ['memberships', 'identity', 'documents', 'addresses', 'audit'] as const;

export default function UserDetailPage() {
  const t = useTranslations('adminUsers');
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [tab, setTab] = useQueryState('tab', parseAsStringLiteral(TABS).withDefault('memberships'));
  const { data, loading, error, refetch } = useAdminUser(id);
  const displayName = useUserDisplayName();
  const user = data?.adminGetUser;

  useBreadcrumbOverride(user ? { [id]: displayName(user) } : {});

  if (loading && !user) {
    return (
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]" data-testid={adminUserDetail.loading}>
        <Skeleton className="h-[420px] w-full" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-[320px] w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    const code = extractGraphQLErrorCode(error);
    const notFound = code === 'NOT_FOUND' || code === 'BAD_REQUEST' || !error;
    return (
      <Empty
        className="py-16"
        data-testid={notFound ? adminUserDetail.notFound : adminUserDetail.loadError}
      >
        <EmptyHeader>
          <EmptyTitle>{notFound ? t('detail.notFound') : t('loadFailed')}</EmptyTitle>
          {notFound && <EmptyDescription>{t('detail.notFoundDescription')}</EmptyDescription>}
        </EmptyHeader>
        {!notFound && (
          <Button variant="outline" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        )}
      </Empty>
    );
  }

  const counts: Record<(typeof TABS)[number], number | null> = {
    memberships:
      user.memberships.length + user.resellerMemberships.length + (user.platformMembership ? 1 : 0),
    identity: user.identifiers.length,
    documents: user.documents.length,
    addresses: user.addresses.length,
    audit: null,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]" data-testid={adminUserDetail.page}>
      <aside>
        <ProfileCard user={user} />
      </aside>
      <Tabs value={tab} onValueChange={(v) => setTab(TABS.find((x) => x === v) ?? null)}>
        {/* The hidden y-axis clips the triggers' invisible underline (::after, 5px below). */}
        <div className="overflow-x-auto overflow-y-hidden">
          <TabsList>
            {TABS.map((name) => (
              <TabsTrigger key={name} value={name} data-testid={adminUserDetail.tab(name)}>
                {t(`tabs.${name}`)}
                {counts[name] !== null && (
                  <span className="ms-1 text-xs text-muted-foreground tabular-nums">
                    ({counts[name]})
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent
          value="memberships"
          className="mt-4"
          data-testid={adminUserDetail.tabContent('memberships')}
        >
          <MembershipsTab user={user} />
        </TabsContent>
        <TabsContent
          value="identity"
          className="mt-4"
          data-testid={adminUserDetail.tabContent('identity')}
        >
          <IdentityTab identifiers={user.identifiers} />
        </TabsContent>
        <TabsContent
          value="documents"
          className="mt-4"
          data-testid={adminUserDetail.tabContent('documents')}
        >
          <DocumentsTab documents={user.documents} />
        </TabsContent>
        <TabsContent
          value="addresses"
          className="mt-4"
          data-testid={adminUserDetail.tabContent('addresses')}
        >
          <AddressesTab addresses={user.addresses} />
        </TabsContent>
        <TabsContent
          value="audit"
          className="mt-4"
          data-testid={adminUserDetail.tabContent('audit')}
        >
          <UserAuditTab userId={user.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
