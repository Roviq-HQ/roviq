# ============================================================
# Institute Status Lifecycle — State Machine Transitions
# Tests every valid transition and guards against invalid ones.
#
# Valid transitions:
#   PENDING  → ACTIVE (only if setupStatus==COMPLETED)
#   PENDING  → REJECTED (terminal)
#   ACTIVE   → INACTIVE
#   ACTIVE   → SUSPENDED
#   INACTIVE → ACTIVE
#   SUSPENDED → ACTIVE
#   REJECTED → * (terminal — no transitions out)
#
# Variables required: base_url, username, password, institute_1_id
# institute_1_id must be ACTIVE with setupStatus==COMPLETED (seed institute)
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

# Step 2: Create a new institute (will start as PENDING with setupStatus != COMPLETED)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation CreateInstitute($input: CreateInstituteInput!) { createInstitute(input: $input) { id status setupStatus } }",
  "variables": {
    "input": {
      "name": { "en": "Status Test Institute" },
      "slug": "status-test-institute",
      "type": "SCHOOL"
    }
  }
}
HTTP 200
[Captures]
new_institute_id: jsonpath "$.data.createInstitute.id"
[Asserts]
jsonpath "$.data.createInstitute.id" != null
jsonpath "$.data.createInstitute.status" == "PENDING"

# Step 3: Try to activateInstitute on a PENDING institute with setupStatus != COMPLETED
# -- Must return an error (setup not complete)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation Activate($id: ID!) { activateInstitute(id: $id) { id status setupStatus } }",
  "variables": { "id": "{{new_institute_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.errors" count >= 1
jsonpath "$.data" == null

# Step 4: Reject the PENDING institute — status should become REJECTED
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation Reject($id: ID!) { rejectInstitute(id: $id) { id status setupStatus } }",
  "variables": { "id": "{{new_institute_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.rejectInstitute.id" == {{new_institute_id}}
jsonpath "$.data.rejectInstitute.status" == "REJECTED"

# Step 5: Try to activate a REJECTED institute — must fail (terminal state, no transitions out)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation Activate($id: ID!) { activateInstitute(id: $id) { id status setupStatus } }",
  "variables": { "id": "{{new_institute_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.errors" count >= 1
jsonpath "$.errors[0].message" contains "Cannot transition from REJECTED to ACTIVE"
jsonpath "$.data" == null

# Step 6: Deactivate the seed institute (ACTIVE -> INACTIVE)
# institute_1_id is the seed institute: ACTIVE + setupStatus==COMPLETED
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation Deactivate($id: ID!) { deactivateInstitute(id: $id) { id status setupStatus } }",
  "variables": { "id": "{{institute_1_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.deactivateInstitute.id" == {{institute_1_id}}
jsonpath "$.data.deactivateInstitute.status" == "INACTIVE"

# Step 7: Re-activate the seed institute (INACTIVE → ACTIVE)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation Activate($id: ID!) { activateInstitute(id: $id) { id status setupStatus } }",
  "variables": { "id": "{{institute_1_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.activateInstitute.id" == {{institute_1_id}}
jsonpath "$.data.activateInstitute.status" == "ACTIVE"

# Step 8: Suspend the seed institute (ACTIVE → SUSPENDED)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation Suspend($id: ID!) { suspendInstitute(id: $id) { id status setupStatus } }",
  "variables": { "id": "{{institute_1_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.suspendInstitute.id" == {{institute_1_id}}
jsonpath "$.data.suspendInstitute.status" == "SUSPENDED"

# Step 9: Resume the seed institute from SUSPENDED (SUSPENDED → ACTIVE)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation Activate($id: ID!) { activateInstitute(id: $id) { id status setupStatus } }",
  "variables": { "id": "{{institute_1_id}}" }
}
HTTP 200
[Asserts]
jsonpath "$.data.activateInstitute.id" == {{institute_1_id}}
jsonpath "$.data.activateInstitute.status" == "ACTIVE"
jsonpath "$.data.activateInstitute.setupStatus" == "COMPLETED"
