# Reseller Portal -- User Guide

This guide walks you through the key features of the Roviq Reseller Portal. It is written for reseller administrators who manage institutes, billing, and account settings.

---

## Table of Contents

1. [Logging In](#logging-in)
2. [Dashboard](#dashboard)
3. [Institute Management](#institute-management)
4. [Billing](#billing)
5. [Audit Logs](#audit-logs)
6. [Impersonation Sessions](#impersonation-sessions)
7. [Settings](#settings)
8. [Sessions](#sessions)
9. [Account -- Passkeys](#account--passkeys)

---

## Logging In

1. Open the Reseller Portal in your browser (e.g. `reseller.roviq.com`).
2. Enter your **Roviq ID** and **Password**.
3. Click **Log In**.

> **Tip:** If you have set up a passkey (fingerprint, face unlock, or security key), you can use it instead of typing a password. See [Account -- Passkeys](#account--passkeys) for setup instructions.

---

## Dashboard

After logging in you land on the Dashboard. It provides quick links to the areas you use most:

- **Institutes** -- view and manage all your institutes
- **Team** -- manage your reseller team members
- **Settings** -- sessions, account, and portal preferences

Use these links or the sidebar navigation to move around the portal.

---

## Institute Management

### Viewing Institutes

1. Click **Institutes** in the sidebar.
2. The **All Institutes** tab shows every institute under your reseller account.
3. Use the controls at the top to narrow results:
   - **Search** -- type a name or code to filter instantly.
   - **Status** -- filter by Active, Suspended, Pending, etc.
   - **Type** -- filter by institute type (e.g. School, Coaching, Library).
   - **Group** -- filter by institute group (trust or chain).
4. Switch to the **Awaiting Approval** tab to see institutes that have been submitted but not yet approved by the platform admin.

### Creating a New Institute

1. On the Institutes page, click **Request New Institute**.
2. Fill in the required fields:

   | Field | Description |
   |-------|-------------|
   | **Institute Name** | Enter the name in English. You can also provide it in Hindi. |
   | **Institute Code** | A unique identifier (e.g. `DPS-GBN-01`). This cannot be changed later. |
   | **Institute Type** | Select the type -- School, Coaching, or Library. |
   | **Structure Framework** | Choose **NEP (5+3+3+4)** or **Traditional (10+2)**. |
   | **Board** | Select the education board -- CBSE, ICSE, BSEH, RBSE, etc. |
   | **Departments** | Tick the academic departments offered: Pre-Primary, Primary, Upper Primary, Secondary, Senior Secondary. |
   | **Group** | Optionally assign the institute to an existing group (trust or chain). |

3. Under **Contact Details**, add at least one phone number:
   - Select the country code (+91 for India).
   - Enter the 10-digit mobile or landline number.
   - Mark one number as **Primary**. Optionally enable **WhatsApp**.
4. Under **Address**, fill in Address Line 1, City, District, State (dropdown), and PIN Code.
5. Click **Submit Request**.

> **Note:** After submission, the institute will appear under the **Awaiting Approval** tab. The platform admin reviews and approves it. You will be notified when the institute is approved and ready to use.

### Viewing Institute Details

1. Click on any institute row in the list to open its detail page.
2. The detail page has five tabs:

   - **Overview** -- Identity (name, code, type, framework), Contact (phones, emails), and Address.
   - **Academic Structure** -- Standards and sections configured for the institute.
   - **Compliance Data** -- Read-only regulatory identifiers and board affiliations.
   - **Users** -- List of users (staff, teachers) in the institute.
   - **Audit Log** -- History of changes made to this institute.

### Suspending an Institute

1. Open the institute's detail page.
2. Click the **Suspend** button.
3. Enter a reason for suspension in the text field.
4. Click **Confirm**.

The institute will be immediately suspended. Users of that institute will not be able to log in until it is reactivated.

### Reactivating a Suspended Institute

1. Open the suspended institute's detail page.
2. Click the **Reactivate** button.
3. Click **Confirm**.

The institute will become active again and its users can log in.

---

## Billing

The Billing section is accessible from the sidebar. It contains six sub-sections: Dashboard, Plans, Subscriptions, Payment Gateways, UPI Verification, and Invoices.

### Billing Dashboard

1. Click **Billing > Dashboard** in the sidebar.
2. View the key performance indicators (KPIs) at the top:
   - **MRR** -- Monthly Recurring Revenue.
   - **Active Subscriptions** -- count of currently active subscriptions.
   - **Churn Rate** -- percentage of subscriptions lost.
   - **Overdue Invoices** -- count of invoices past their due date.
3. Below the KPIs, a **Subscriptions by Status** chart shows how your subscriptions are distributed across statuses.

### Plans

Plans define the pricing and limits you offer to your institutes.

#### Creating a Plan

1. Click **Billing > Plans** in the sidebar.
2. Click **Create Plan**.
3. Fill in the fields:
   - **Plan Name** -- provide in English (required) and optionally in Hindi.
   - **Plan Code** -- a unique identifier for internal use.
   - **Amount** -- enter the price in rupees (e.g. 5000). The system stores this in paise internally.
   - **Billing Interval** -- how often the plan is billed (e.g. monthly, yearly).
   - **Trial Days** -- number of free trial days (0 if none).
   - **Limits** -- set any usage limits for the plan (e.g. max students, max staff).
4. Click **Create**.

#### Editing a Plan

1. In the Plans list, click on the plan you want to change.
2. Update the fields as needed.
3. Click **Save Changes**.

#### Archiving and Restoring a Plan

- To archive a plan you no longer want to offer, click the **Archive** action. Archived plans cannot be assigned to new subscriptions but existing subscriptions remain unaffected.
- To bring back an archived plan, click **Restore**.

#### Deleting a Plan

- Click **Delete** to permanently remove a plan. This is only possible if the plan has no active subscriptions.

### Subscriptions

Subscriptions link a plan to an institute.

#### Assigning a Plan to an Institute

1. Click **Billing > Subscriptions** in the sidebar.
2. Click **Create Subscription** (or similar action button).
3. Select the **Institute** from the dropdown.
4. Select the **Plan** to assign.
5. Click **Create**.

#### Managing Subscriptions

- Use the **Status** filter to view Active, Paused, Cancelled, or other subscription states.
- **Cancel** -- permanently ends the subscription.
- **Pause** -- temporarily halts billing. The institute retains access but no invoices are generated.
- **Resume** -- reactivates a paused subscription and resumes billing.

### Payment Gateways

Configure how you accept payments from institutes.

#### Adding a Gateway

1. Click **Billing > Payment Gateways** in the sidebar.
2. Click **Add Gateway**.
3. Select the gateway type and fill in the required credentials:

   | Gateway | Fields |
   |---------|--------|
   | **UPI_DIRECT** | VPA (UPI ID, e.g. `business@upi`) |
   | **RAZORPAY** | Key ID, Key Secret |
   | **CASHFREE** | (Follow the on-screen fields) |

4. Click **Save**.

#### Editing a Gateway

1. Click on an existing gateway configuration.
2. The form will autofill with the current values (e.g. VPA for UPI_DIRECT).
3. Update fields and click **Save Changes**.

#### Other Gateway Actions

- **Set as Default** -- mark a gateway as the default for new subscriptions. A reseller has one default gateway at a time; setting a new one replaces the old. A bare UPI address (UPI Direct) cannot be the default because it cannot take online orders.
- **Test Mode** -- toggle test mode on or off. When test mode is enabled, no real transactions are processed.

### UPI Verification

When institutes make UPI peer-to-peer payments, those payments appear here for manual verification.

1. Click **Billing > UPI Verification** in the sidebar.
2. Review the list of unverified payments.
3. For each payment, click **Verify** to confirm it, or **Reject** if the payment is invalid.

### Invoices

1. Click **Billing > Invoices** in the sidebar.
2. Browse the list of all invoices. Click any row to open the detail drawer.
3. Available actions on an invoice:
   - **Record Payment** -- mark an invoice as paid (for offline or manual payments).
   - **Refund** -- issue a refund for a paid invoice.
   - **Download PDF** -- download a PDF copy of the invoice.

---

## Team

The Team page (`/reseller/team`) lists the people from your organisation who can sign in to the Reseller Portal.

1. Click **Team** in the sidebar. Each row shows the member's name, email, **role**, **status** (Active or Inactive), when they were last active and when they joined. Your own row carries a **You** badge.
2. Use the search box (name, email or Roviq ID) and the **status** filter to narrow the list. Filters are kept in the page address, so a filtered view can be bookmarked or shared.
3. Click a row to open the member's detail panel: profile, **active sessions** (device, IP address, sign-in time) and their **recent activity** from the audit log. Sessions are shown only for yourself and for members you are allowed to manage.

### Roles

| Role | Can do |
|---|---|
| Reseller admin | Manage institutes, billing and the team. |
| Reseller support | Read everything, view as institute users **in view-only mode**, and manage Support and Viewer members. |
| Reseller viewer | Read only. The Team page shows no Invite button and no row actions. |

You can give roles up to your own, and never above your organisation's plan tier. You cannot change members who hold a role above yours, and you cannot change your own role or status.

### Invite a member

1. Click **Invite member**.
2. Enter the person's **email** and choose a **role**.
3. Click **Invite**. If the email already has a Roviq account, that account is added to your team and keeps its password. Otherwise a new account is created and a temporary password is sent to the address.

If the person is already on your team (even as an inactive member) the invite is refused; reactivate them from the list.

### Change a role, deactivate, reactivate

Open the **⋯** menu at the end of a member's row.

- **Change role** -- pick another role and confirm. It applies at once.
- **Deactivate** -- the member is signed out immediately and cannot sign in to this portal until reactivated. Their Roviq account and any other memberships are untouched.
- **Reactivate** -- shown for inactive members; they can sign in again with their existing role.

---

## Audit Logs

Audit Logs record every significant action taken in the reseller portal.

1. Click **Audit Logs** in the sidebar.
2. The table shows all logged events. Use the filters at the top to narrow results:
   - **Entity Type** -- filter by the type of object affected (e.g. Institute, Plan, Subscription).
   - **Action Type** -- filter by the kind of action (e.g. Created, Updated, Deleted).
   - **Date** -- filter by date range.
3. Click any row to open a **detail side-sheet** showing the full audit record, including who made the change, when, and what was changed.

---

## Impersonation Sessions

Review and control the impersonation sessions started by your team (when a team member logs in as an institute user).

1. Open **Audit Logs > Impersonation** (`/reseller/audit/impersonation`).
2. The table lists each session with the team member, target user, institute, reason, start and expiry time, and a **status** badge: Active, Ended (the team member left), Revoked (someone else ended it) or Expired.
3. Use the **Institute** dropdown to filter sessions to a single managed institute.
4. For an **Active** session, click **Terminate** to immediately sign the team member out of the impersonated account (you'll be asked to confirm). Viewers see the list without the Terminate button.

### View as an institute user

1. On an institute's **Users** tab click **View as** and give a reason of at least 10 characters.
2. The institute admin is sent a 6-digit code. Ask them for it and enter it. **Send a new code** becomes available 30 seconds after the last one.
3. A new tab opens signed in as that user. If your role is **Reseller support**, the banner says **View only**: you can look at every screen the user sees, but nothing can be changed in that session.

---

## Settings

Click **Settings** in the sidebar. The page has four sections: **Profile**, **Branding**, **Custom domain** and **Sessions**. Only a **Reseller admin** can change the first two; other roles see them read-only.

### Profile

- **Name** -- your organisation's name. (The built-in Roviq Direct reseller cannot be renamed.)
- **Slug**, **Tier** and **Status** are shown for reference. They are set by Roviq and cannot be changed here.
- **Business registration** -- registration number (CIN, GSTIN) and state.
- **Contact** and **Registered address** -- how Roviq reaches you. Leave the first address line empty to keep no address on file.

Click **Save changes**. If a colleague saved while you were editing, you are told so and the latest version is loaded; make your change again.

### Branding

The form is on the left and a **live preview** on the right (below the form on a small screen).

- **Primary colour** and **Secondary colour** -- pick with the colour box or type a six-digit hex code such as `#1677FF`. **Use default** clears your choice.
- **Colour scheme** -- Light, Dark, or Match device.
- **Advanced > Custom CSS** -- extra style rules, up to 20,000 characters. Rules that would load a file from another site (`@import`, `url(...)`) or contain HTML are refused, and the message names what to remove.
- **Logo** and **Favicon** -- drag an image in or click **Choose files** (JPG, PNG or WebP; logo up to 5 MB, favicon up to 2 MB). The favicon is stored square. Click **Save changes** to apply; the logo then appears in the preview. **Remove** takes an image away at the next save, and **Keep it** undoes that before you save.

Your branding is saved now and will be applied to your portal when white-label support launches. Until then the preview is the only place it shows.

### Custom domain

Custom domains are not available yet. The page shows the address your portal uses today and, if Roviq has recorded a domain for you, that domain in a disabled field. Use **Contact support** to ask about it.

---

## Sessions

Manage your active login sessions to keep your account secure.

1. Click **Settings** in the sidebar, then the **Sessions** section.
2. View all active sessions, including device and browser information.
3. To end a specific session, click **Revoke** next to it.
4. To end all sessions except the one you are currently using, click **Revoke All Others**.

> **Tip:** If you suspect unauthorised access, use **Revoke All Others** immediately and then change your password.

---

## Account -- Passkeys

Passkeys let you log in using your device's biometrics (fingerprint or face) or a physical security key, without typing a password.

### Adding a Passkey

1. Click **Settings > Account** in the sidebar.
2. In the **Passkeys** section, click **Add Passkey**.
3. Follow your browser's prompt to register a fingerprint, face, or security key.
4. The passkey will appear in the list with details about the device and date added.

### Removing a Passkey

1. In the Passkeys list, find the passkey you want to remove.
2. Click **Remove** (or the delete icon).
3. Confirm the removal.

> **Note:** If you remove all passkeys, you will need to use your Roviq ID and password to log in.

---

## Need Help?

If you encounter any issues or have questions, contact Roviq support through your reseller account manager or the help section in the portal.
