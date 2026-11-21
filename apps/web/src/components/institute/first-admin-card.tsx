'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';

export interface InstituteFirstAdmin {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  phone?: string | null;
  /** The account is not one the viewing reseller created, so only its email is returned. */
  detailsWithheld: boolean;
}

export interface FirstAdminCardLabels {
  title: string;
  description: string;
  name: string;
  email: string;
  phone: string;
  none: string;
  withheld: string;
}

/** The person named on an institute request or creation to receive the admin login. */
export function FirstAdminCard({
  firstAdmin,
  labels,
  testId,
}: {
  firstAdmin: InstituteFirstAdmin | null | undefined;
  labels: FirstAdminCardLabels;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {firstAdmin ? (
          <FirstAdminDetails firstAdmin={firstAdmin} labels={labels} />
        ) : (
          <p className="text-sm text-muted-foreground">{labels.none}</p>
        )}
      </CardContent>
    </Card>
  );
}

function FirstAdminDetails({
  firstAdmin,
  labels,
}: {
  firstAdmin: InstituteFirstAdmin;
  labels: FirstAdminCardLabels;
}) {
  if (firstAdmin.detailsWithheld) {
    return (
      <div className="space-y-2 text-sm">
        <dl>
          <dt className="text-muted-foreground">{labels.email}</dt>
          <dd className="break-all">{firstAdmin.email}</dd>
        </dl>
        <p className="text-muted-foreground">{labels.withheld}</p>
      </div>
    );
  }
  const name = [firstAdmin.firstName, firstAdmin.lastName].filter(Boolean).join(' ');
  return (
    <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">{labels.name}</dt>
        <dd className="font-medium break-all">{name || firstAdmin.email}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{labels.email}</dt>
        <dd className="break-all">{firstAdmin.email}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{labels.phone}</dt>
        <dd>{firstAdmin.phone ? formatPhone(firstAdmin.phone) : '—'}</dd>
      </div>
    </dl>
  );
}

/** The API returns Indian numbers without +91 and others with their country code. */
function formatPhone(phone: string): string {
  return phone.startsWith('+') ? phone : `+91 ${phone}`;
}
