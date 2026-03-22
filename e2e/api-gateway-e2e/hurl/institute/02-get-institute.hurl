# ============================================================
# Get Institute — single-fetch queries
# Tests: institute(id), myInstitute, and not-found error
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

# Step 2: Get institute by known seed ID
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "query GetInstitute($id: ID!) { institute(id: $id) { id name slug type status setupStatus timezone currency contact } }",
  "variables": { "id": "{{institute_1_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.institute.id" == "{{institute_1_id}}"
jsonpath "$.data.institute.name" != null
jsonpath "$.data.institute.slug" != null
jsonpath "$.data.institute.type" != null
jsonpath "$.data.institute.status" != null
jsonpath "$.data.institute.setupStatus" != null
jsonpath "$.data.institute.timezone" != null
jsonpath "$.data.institute.currency" != null
jsonpath "$.data.institute.contact" != null

# Step 3: myInstitute — resolves from JWT context
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "query MyInstitute { myInstitute { id name slug type status setupStatus timezone currency } }"
}
HTTP 200
[Asserts]
jsonpath "$.data.myInstitute.id" != null
jsonpath "$.data.myInstitute.name" != null
jsonpath "$.data.myInstitute.slug" != null

# Step 4: Get non-existent institute — expect GraphQL errors
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "query GetInstitute($id: ID!) { institute(id: $id) { id name } }",
  "variables": { "id": "00000000-0000-0000-0000-000000000000" }
}
HTTP 200
[Asserts]
jsonpath "$.errors" not isEmpty
