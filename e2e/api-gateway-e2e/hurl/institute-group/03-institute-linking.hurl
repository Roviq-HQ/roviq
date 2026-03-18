# ============================================================
# Institute Group — Institute Linking
# Tests: addInstituteToGroup, removeInstituteFromGroup
# Variables required: base_url, username, password,
#                     institute_1_id, institute_2_id
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

# Step 3: Create a group for linking
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation CreateInstituteGroup($input: CreateInstituteGroupInput!) { createInstituteGroup(input: $input) { id name code type status } }",
  "variables": {
    "input": {
      "name": "Society Link Test",
      "code": "society-link-e2e",
      "type": "SOCIETY"
    }
  }
}
HTTP 200
[Captures]
group_id: jsonpath "$.data.createInstituteGroup.id"
[Asserts]
jsonpath "$.data.createInstituteGroup.id" != null
jsonpath "$.data.createInstituteGroup.type" == "SOCIETY"
jsonpath "$.data.createInstituteGroup.status" == "ACTIVE"

# Step 4: Add institute_1 to the group
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation AddInstituteToGroup($instituteId: ID!, $groupId: ID!) { addInstituteToGroup(instituteId: $instituteId, groupId: $groupId) }",
  "variables": { "instituteId": "{{institute_1_id}}", "groupId": "{{group_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.addInstituteToGroup" == true

# Step 5: Add institute_2 to the group
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation AddInstituteToGroup($instituteId: ID!, $groupId: ID!) { addInstituteToGroup(instituteId: $instituteId, groupId: $groupId) }",
  "variables": { "instituteId": "{{institute_2_id}}", "groupId": "{{group_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.addInstituteToGroup" == true

# Step 6: Remove institute_1 from the group
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation RemoveInstituteFromGroup($instituteId: ID!) { removeInstituteFromGroup(instituteId: $instituteId) }",
  "variables": { "instituteId": "{{institute_1_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.removeInstituteFromGroup" == true

# Step 7: Delete group (cleanup)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation DeleteInstituteGroup($id: ID!) { deleteInstituteGroup(id: $id) }",
  "variables": { "id": "{{group_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.deleteInstituteGroup" == true
