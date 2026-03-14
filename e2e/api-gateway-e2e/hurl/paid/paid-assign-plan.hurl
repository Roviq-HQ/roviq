# ============================================================
# Paid Plan Assignment (requires gateway sandbox credentials)
# Creates a paid plan, assigns it to an org, and verifies that
# a checkoutUrl is returned with PENDING_PAYMENT status.
# ============================================================

# Step 1: Login
POST {{base_url}}/graphql
Content-Type: application/json
{
  "query": "mutation Login($username: String!, $password: String!) { login(username: $username, password: $password) { platformToken memberships { tenantId orgName } } }",
  "variables": { "username": "{{username}}", "password": "{{password}}" }
}
HTTP 200
[Captures]
platform_token: jsonpath "$.data.login.platformToken"
tenant_id: jsonpath "$.data.login.memberships[0].tenantId"

# Step 2: Select organization
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

# Step 3: Create a paid plan (amount > 0 triggers gateway interaction)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation CreatePlan($input: CreatePlanInput!) { createSubscriptionPlan(input: $input) { id name amount } }",
  "variables": {
    "input": {
      "name": "Hurl Paid Test Plan",
      "amount": 49900,
      "currency": "INR",
      "billingInterval": "MONTHLY",
      "featureLimits": { "maxUsers": 25 }
    }
  }
}
HTTP 200
[Captures]
plan_id: jsonpath "$.data.createSubscriptionPlan.id"
[Asserts]
jsonpath "$.data.createSubscriptionPlan.amount" == 49900

# Step 4: Get the first org's ID
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "{ organizations { id name } }"
}
HTTP 200
[Captures]
org_id: jsonpath "$.data.organizations[0].id"

# Step 5: Assign the paid plan → gateway creates provider plan + subscription (fresh DB — no existing sub)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation AssignPlan($input: AssignPlanInput!) { assignPlanToOrganization(input: $input) { subscription { id status providerSubscriptionId } checkoutUrl } }",
  "variables": {
    "input": {
      "organizationId": "{{org_id}}",
      "planId": "{{plan_id}}",
      "provider": "{{provider}}",
      "customerEmail": "test@roviq.com",
      "customerPhone": "+919999999999"
    }
  }
}
HTTP 200
[Captures]
sub_id: jsonpath "$.data.assignPlanToOrganization.subscription.id"
checkout_url: jsonpath "$.data.assignPlanToOrganization.checkoutUrl"
[Asserts]
jsonpath "$.data.assignPlanToOrganization.subscription.status" == "PENDING_PAYMENT"
jsonpath "$.data.assignPlanToOrganization.subscription.providerSubscriptionId" != null
jsonpath "$.data.assignPlanToOrganization.checkoutUrl" != null

# Step 7: Verify subscription via query
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "query Sub($orgId: ID!) { subscription(organizationId: $orgId) { id status providerSubscriptionId } }",
  "variables": { "orgId": "{{org_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.subscription.id" == {{sub_id}}
jsonpath "$.data.subscription.status" == "PENDING_PAYMENT"
jsonpath "$.data.subscription.providerSubscriptionId" != null
