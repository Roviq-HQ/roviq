# ============================================================
# Assign Plan to Organization
# Authenticates, creates a free plan, cancels any existing
# subscription on the target org, then assigns the free plan.
# ============================================================

# Step 1: Login (multi-org admin)
POST {{base_url}}/graphql
Content-Type: application/json
{
  "query": "mutation Login($username: String!, $password: String!) { login(username: $username, password: $password) { platformToken memberships { tenantId orgName } } }",
  "variables": { "username": "{{username}}", "password": "{{password}}" }
}
HTTP 200
[Captures]
platform_token: jsonpath "$.data.login.platformToken"
tenant_id: jsonpath "$.data.login.memberships[1].tenantId"

# Step 2: Select organization (second org)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{platform_token}}
{
  "query": "mutation SelectOrg($tenantId: String!) { selectOrganization(tenantId: $tenantId) { accessToken } }",
  "variables": { "tenantId": "{{tenant_id}}" }
}
HTTP 200
[Captures]
access_token: jsonpath "$.data.selectOrganization.accessToken"

# Step 3: Create a free plan (amount=0 → no gateway interaction)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation CreatePlan($input: CreatePlanInput!) { createSubscriptionPlan(input: $input) { id name amount } }",
  "variables": {
    "input": {
      "name": "Hurl Free Test Plan",
      "amount": 0,
      "currency": "INR",
      "billingInterval": "MONTHLY",
      "featureLimits": { "maxUsers": 5 }
    }
  }
}
HTTP 200
[Captures]
plan_id: jsonpath "$.data.createSubscriptionPlan.id"
[Asserts]
jsonpath "$.data.createSubscriptionPlan.amount" == 0

# Step 4: Get the second org's ID
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "{ organizations { id name } }"
}
HTTP 200
[Captures]
org_id: jsonpath "$.data.organizations[1].id"

# Step 5: Assign the free plan to the org (fresh DB — no existing sub)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation AssignPlan($input: AssignPlanInput!) { assignPlanToOrganization(input: $input) { subscription { id status organizationId planId } checkoutUrl } }",
  "variables": {
    "input": {
      "organizationId": "{{org_id}}",
      "planId": "{{plan_id}}",
      "provider": "RAZORPAY",
      "customerEmail": "test@roviq.com",
      "customerPhone": "+919999999999"
    }
  }
}
HTTP 200
[Asserts]
jsonpath "$.data.assignPlanToOrganization.subscription.id" != null
jsonpath "$.data.assignPlanToOrganization.subscription.status" == "ACTIVE"
jsonpath "$.data.assignPlanToOrganization.checkoutUrl" == null
