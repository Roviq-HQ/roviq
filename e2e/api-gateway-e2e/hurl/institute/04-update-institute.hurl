# ============================================================
# Update Institute Info
# Tests: updateInstituteInfo mutation — name, contact, address,
#        timezone, currency fields updated independently.
# ============================================================

# Step 1: Login (capture platform_token and tenant_id)
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
jsonpath "$.data.login.memberships" count >= 1

# Step 2: Select institute → get access_token
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{platform_token}}
{
  "query": "mutation SelectInstitute($tenantId: String!) { selectInstitute(tenantId: $tenantId) { accessToken user { id username } } }",
  "variables": { "tenantId": "{{tenant_id}}" }
}
HTTP 200
[Captures]
access_token: jsonpath "$.data.selectInstitute.accessToken"
[Asserts]
jsonpath "$.data.selectInstitute.accessToken" != null

# Step 3: Create a new institute to update
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation CreateInstitute($input: CreateInstituteInput!) { createInstitute(input: $input) { id name code contact address timezone currency status } }",
  "variables": {
    "input": {
      "name": {"en": "Hurl Update Test"},
      "slug": "hurl-update-test",
      "type": "SCHOOL"
    }
  }
}
HTTP 200
[Captures]
institute_id: jsonpath "$.data.createInstitute.id"
[Asserts]
jsonpath "$.data.createInstitute.id" != null
jsonpath "$.data.createInstitute.name.en" == "Hurl Update Test"

# Step 4: Update name (English + Hindi)
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation UpdateInstituteInfo($id: ID!, $input: UpdateInstituteInfoInput!) { updateInstituteInfo(id: $id, input: $input) { id name code contact address timezone currency status } }",
  "variables": {
    "id": "{{institute_id}}",
    "input": {
      "name": {"en": "Hurl Updated Name", "hi": "हर्ल अपडेट टेस्ट"}
    }
  }
}
HTTP 200
[Asserts]
jsonpath "$.data.updateInstituteInfo.id" == "{{institute_id}}"
jsonpath "$.data.updateInstituteInfo.name.en" == "Hurl Updated Name"
jsonpath "$.data.updateInstituteInfo.name.hi" == "हर्ल अपडेट टेस्ट"

# Step 5: Update contact
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation UpdateInstituteInfo($id: ID!, $input: UpdateInstituteInfoInput!) { updateInstituteInfo(id: $id, input: $input) { id name code contact address timezone currency status } }",
  "variables": {
    "id": "{{institute_id}}",
    "input": {
      "contact": {"email": "updated@roviq.com", "phone": "+910000000001"}
    }
  }
}
HTTP 200
[Asserts]
jsonpath "$.data.updateInstituteInfo.id" == "{{institute_id}}"
jsonpath "$.data.updateInstituteInfo.contact.email" == "updated@roviq.com"
jsonpath "$.data.updateInstituteInfo.contact.phone" == "+910000000001"

# Step 6: Update address
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation UpdateInstituteInfo($id: ID!, $input: UpdateInstituteInfoInput!) { updateInstituteInfo(id: $id, input: $input) { id name code contact address timezone currency status } }",
  "variables": {
    "id": "{{institute_id}}",
    "input": {
      "address": {"line1": "123 Main St", "city": "Mumbai", "state": "MH", "country": "IN", "postalCode": "400001"}
    }
  }
}
HTTP 200
[Asserts]
jsonpath "$.data.updateInstituteInfo.id" == "{{institute_id}}"
jsonpath "$.data.updateInstituteInfo.address.city" == "Mumbai"
jsonpath "$.data.updateInstituteInfo.address.line1" == "123 Main St"
jsonpath "$.data.updateInstituteInfo.address.state" == "MH"
jsonpath "$.data.updateInstituteInfo.address.country" == "IN"
jsonpath "$.data.updateInstituteInfo.address.postalCode" == "400001"

# Step 7: Update timezone and currency
POST {{base_url}}/graphql
Content-Type: application/json
Authorization: Bearer {{access_token}}
{
  "query": "mutation UpdateInstituteInfo($id: ID!, $input: UpdateInstituteInfoInput!) { updateInstituteInfo(id: $id, input: $input) { id name code contact address timezone currency status } }",
  "variables": {
    "id": "{{institute_id}}",
    "input": {
      "timezone": "Asia/Kolkata",
      "currency": "INR"
    }
  }
}
HTTP 200
[Asserts]
jsonpath "$.data.updateInstituteInfo.id" == "{{institute_id}}"
jsonpath "$.data.updateInstituteInfo.timezone" == "Asia/Kolkata"
jsonpath "$.data.updateInstituteInfo.currency" == "INR"
