# ============================================================
# Institute Group — Not Found Error Handling
# Tests: get and delete with non-existent IDs
# ============================================================

# Step 1: Login
POST {{base_url}}/graphql
Content-Type: application/json
{
  "query": "mutation Login($username: String!, $password: String!) { login(username: $username, password: $password) { platformToken memberships { tenantId instituteName } } }",
  "variables": { "username": "{{username}}", "password": "{{password}}" }
}
HTTP 200
[Captures]
platform_token: jsonpath "$.data.login.platformToken"
tenant_id: jsonpath "$.data.login.memberships[0].tenantId"
[Asserts]
jsonpath "$.data.login.platformToken" != null

# Step 2: Select institute -> get accessToken
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{platform_token}}
{
  "query": "mutation SelectInstitute($tenantId: String!) { selectInstitute(tenantId: $tenantId) { accessToken } }",
  "variables": { "tenantId": "{{tenant_id}}" }
}
HTTP 200
[Captures]
access_token: jsonpath "$.data.selectInstitute.accessToken"
[Asserts]
jsonpath "$.data.selectInstitute.accessToken" != null

# Step 3: Get a non-existent group by ID — expect errors
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "query GetInstituteGroup($id: ID!) { instituteGroup(id: $id) { id name code type status } }",
  "variables": { "id": "00000000-0000-0000-0000-000000000000" }
}
HTTP 200
[Asserts]
jsonpath "$.errors" count >= 1

# Step 4: Delete a non-existent group — expect errors
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation DeleteInstituteGroup($id: ID!) { deleteInstituteGroup(id: $id) }",
  "variables": { "id": "00000000-0000-0000-0000-000000000000" }
}
HTTP 200
[Asserts]
jsonpath "$.errors" count >= 1
