# ============================================================
# Institute Soft Delete and Restore
# Tests: deleteInstitute mutation, soft-delete visibility,
#        restoreInstitute mutation, and not-found error handling
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

# Step 2: Create a fresh institute to be deleted
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation CreateInstitute($input: CreateInstituteInput!) { createInstitute(input: $input) { id name slug status } }",
  "variables": {
    "input": {
      "name": { "en": "Hurl Delete Test" },
      "slug": "hurl-delete-test",
      "type": "SCHOOL"
    }
  }
}
HTTP 200
[Captures]
delete_institute_id: jsonpath "$.data.createInstitute.id"
[Asserts]
jsonpath "$.data.createInstitute.id" != null
jsonpath "$.data.createInstitute.name.en" == "Hurl Delete Test"
jsonpath "$.data.createInstitute.slug" == "hurl-delete-test"

# Step 3: Delete the institute — expect true
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation DeleteInstitute($id: ID!) { deleteInstitute(id: $id) }",
  "variables": { "id": "{{delete_institute_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.deleteInstitute" == true

# Step 4: Attempt to fetch the soft-deleted institute — expect errors
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "query GetInstitute($id: ID!) { institute(id: $id) { id name slug status } }",
  "variables": { "id": "{{delete_institute_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.errors" count >= 1

# Step 5: Restore the institute — expect id and non-null status
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation RestoreInstitute($id: ID!) { restoreInstitute(id: $id) { id name slug status } }",
  "variables": { "id": "{{delete_institute_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.restoreInstitute.id" == {{delete_institute_id}}
jsonpath "$.data.restoreInstitute.status" != null

# Step 6: Verify restored institute is accessible
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "query GetInstitute($id: ID!) { institute(id: $id) { id name slug status } }",
  "variables": { "id": "{{delete_institute_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.institute.id" == {{delete_institute_id}}
jsonpath "$.data.institute.name.en" == "Hurl Delete Test"

# Step 7: Attempt to delete a non-existent institute — expect errors
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation DeleteInstitute($id: ID!) { deleteInstitute(id: $id) }",
  "variables": { "id": "00000000-0000-0000-0000-000000000000" }
}
HTTP 200
[Asserts]
jsonpath "$.errors" count >= 1
