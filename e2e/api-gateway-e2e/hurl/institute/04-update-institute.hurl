# ============================================================
# Update Institute Info
# Tests: updateInstituteInfo mutation — name, contact, address,
#        timezone, currency fields updated independently.
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

# Step 2: Create a new institute to update
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

# Step 3: Update name (English + Hindi)
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

# Step 4: Update contact
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

# Step 5: Update address
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

# Step 6: Update timezone and currency
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
