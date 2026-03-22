# ============================================================
# Institute Group — Institute Linking
# Tests: addInstituteToGroup, removeInstituteFromGroup
# Variables required: base_url, username, password,
#                     institute_1_id, institute_2_id
# ============================================================

# Step 1: Admin login (platform scope — returns accessToken directly)
POST {{base_url}}/graphql
Content-Type: application/json
{
  "query": "mutation { adminLogin(username: \"{{username}}\", password: \"{{password}}\") { accessToken } }"
}
HTTP 200
[Captures]
access_token: jsonpath "$.data.adminLogin.accessToken"
[Asserts]
jsonpath "$.data.adminLogin.accessToken" != null

# Step 2: Create a group for linking
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

# Step 3: Add institute_1 to the group
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

# Step 4: Add institute_2 to the group
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

# Step 5: Remove institute_1 from the group
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

# Step 6: Delete group (cleanup)
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
